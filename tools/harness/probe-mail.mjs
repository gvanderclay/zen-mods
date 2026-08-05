/**
 * Measures the two signals M07 could be built on, from inside Zen's parent process
 * rather than from a shell — because that is the only place the answer counts.
 *
 * 1. `Subprocess`: whether a mod can spawn anything at all, and what a round trip
 *    through `osascript` costs. The script it runs targets no application, so it
 *    raises no Apple Events prompt: Zen holds no `kTCCServiceAppleEvents` grant, and
 *    a prompt nobody is there to answer is a hung probe and a stray modal dialog.
 * 2. The Gmail Atom feed: whether a system-principal `fetch` reaches it, and what it
 *    answers. This profile is signed out of everything, so a 401 here is the expected
 *    result and the shape of the signed-out case both.
 *
 *     node tools/harness/probe-mail.mjs
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { openMarionette } from "./marionette.mjs";
import { launchZen } from "./zen.mjs";

const FEED = "https://mail.google.com/mail/feed/atom";
const ENVELOPE = join(homedir(), "Library/Mail/V10/MailData/Envelope Index");

const PROBE = `
  const done = arguments[arguments.length - 1];
  const feedUrl = arguments[0];
  const out = { subprocess: {}, fetch: {} };
  const now = () => Services.telemetry ? performance.now() : Date.now();

  const main = async () => {
    // Can a mod spawn at all?
    let Subprocess;
    try {
      ({ Subprocess } = ChromeUtils.importESModule("resource://gre/modules/Subprocess.sys.mjs"));
      out.subprocess.module = "imported";
    } catch (error) {
      out.subprocess.module = "IMPORT FAILED: " + String(error);
    }

    if (Subprocess) {
      const call = async (label, command, args, timings) => {
        const started = now();
        try {
          const proc = await Subprocess.call({
            command,
            arguments: args,
            stderr: "pipe",
          });
          const stdout = await proc.stdout.readString();
          const { exitCode } = await proc.wait();
          const ms = Math.round(now() - started);
          timings.push(ms);
          return { label, ms, exitCode, stdout: stdout.trim().slice(0, 200) };
        } catch (error) {
          return { label, ms: Math.round(now() - started), failure: String(error) };
        }
      };

      const echo = [];
      out.subprocess.echo = [];
      for (let i = 0; i < 3; i++) {
        out.subprocess.echo.push(await call("echo", "/bin/echo", ["keep-loaded"], echo));
      }

      // The real cost a Mail poll would pay: interpreter startup plus the round trip.
      // 'return 1+1' talks to no application, so TCC is not involved.
      const osa = [];
      out.subprocess.osascript = [];
      for (let i = 0; i < 5; i++) {
        out.subprocess.osascript.push(
          await call("osascript", "/usr/bin/osascript", ["-e", "return 1+1"], osa),
        );
      }

      // Whether the mod can even tell if Mail is running without launching it. Reading
      // a process list is not an Apple Event, so this stays prompt-free.
      out.subprocess.pgrep = await call("pgrep", "/usr/bin/pgrep", ["-x", "Mail"], []);

      const median = list => list.slice().sort((a, b) => a - b)[Math.floor(list.length / 2)];
      out.subprocess.medianMs = { echo: median(echo), osascript: median(osa) };
    }

    // The feed, from a system principal with this profile's (empty) cookie jar.
    for (const credentials of ["include", "omit"]) {
      const started = now();
      try {
        const response = await fetch(feedUrl, { credentials, redirect: "manual" });
        const body = await response.text();
        out.fetch[credentials] = {
          ms: Math.round(now() - started),
          status: response.status,
          type: response.type,
          redirected: response.redirected,
          location: response.headers.get("location"),
          authenticate: response.headers.get("www-authenticate"),
          contentType: response.headers.get("content-type"),
          bytes: body.length,
          head: body.slice(0, 160),
        };
      } catch (error) {
        out.fetch[credentials] = { ms: Math.round(now() - started), failure: String(error) };
      }
    }

    // Does the cookie service hold anything for the feed's host? On a real profile this
    // is what decides whether the fetch above is authenticated.
    try {
      const uri = Services.io.newURI(feedUrl);
      out.cookies = Services.cookies.countCookiesFromHost(uri.host);
    } catch (error) {
      out.cookies = "FAILED: " + String(error);
    }

    // Reading Mail's own database would skip AppleScript entirely, but ~/Library/Mail is
    // behind Full Disk Access. The terminal has it and Zen does not, so this has to be
    // asked from Zen or the answer is the wrong app's. Failing is the expected result.
    out.mailFile = {};
    const envelope = arguments[1];
    try {
      const stat = await IOUtils.stat(envelope);
      out.mailFile.stat = { size: stat.size };
    } catch (error) {
      out.mailFile.stat = "REFUSED: " + String(error).slice(0, 200);
    }
    try {
      const bytes = await IOUtils.read(envelope, { maxBytes: 16 });
      out.mailFile.read = "read " + bytes.length + " bytes";
    } catch (error) {
      out.mailFile.read = "REFUSED: " + String(error).slice(0, 200);
    }

    // If the point of relaying to Mail is a native notification, the browser can post
    // one itself. Resolved but never fired: firing it would put a banner on the screen.
    try {
      const service = Cc["@mozilla.org/alerts-service;1"].getService(Ci.nsIAlertsService);
      out.alerts = {
        service: Boolean(service),
        showAlert: typeof service.showAlert,
        manualDoNotDisturb: (() => {
          try {
            return service.manualDoNotDisturb;
          } catch (error) {
            return "unsupported: " + String(error).slice(0, 80);
          }
        })(),
      };
    } catch (error) {
      out.alerts = "FAILED: " + String(error).slice(0, 200);
    }

    // What spawning costs the UI thread. Subprocess is asynchronous, so the claim under
    // test is that a poll is wall-clock cost and not jank; a timer's own drift is the
    // cheapest way to see the main thread stall.
    if (Subprocess) {
      const drift = async spawning => {
        const gaps = [];
        let last = now();
        let running = true;
        const tick = () => {
          const at = now();
          gaps.push(at - last);
          last = at;
          if (running) {
            setTimeout(tick, 16);
          }
        };
        setTimeout(tick, 16);
        const work = [];
        if (spawning) {
          for (let i = 0; i < 20; i++) {
            work.push(
              Subprocess.call({
                command: "/usr/bin/osascript",
                arguments: ["-e", "return 1+1"],
                stderr: "pipe",
              }).then(async proc => {
                await proc.stdout.readString();
                return proc.wait();
              }),
            );
          }
        }
        await new Promise(resolve => setTimeout(resolve, 1500));
        await Promise.all(work);
        running = false;
        const sorted = gaps.slice(1).sort((a, b) => a - b);
        return {
          ticks: sorted.length,
          medianGapMs: Math.round(sorted[Math.floor(sorted.length / 2)] * 10) / 10,
          worstGapMs: Math.round(sorted[sorted.length - 1] * 10) / 10,
        };
      };
      out.jank = { idle: await drift(false), spawning20: await drift(true) };
    }

    return out;
  };

  main().then(done, error => done({ failure: String(error), stack: String(error?.stack ?? "").split("\\n").slice(0, 3).join(" | ") }));
`;

const main = async () => {
  const zen = await launchZen();
  let client;
  try {
    client = await openMarionette({ port: zen.port });
    await client.setScriptTimeout(60_000);
    const result = await client.executeAsync(PROBE, [FEED, ENVELOPE]);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`harness failed: ${error.message}`);
    console.error(zen.output.join("").slice(-2000));
    process.exitCode = 1;
  } finally {
    await client?.quit();
    await zen.stop();
  }
};

await main();
