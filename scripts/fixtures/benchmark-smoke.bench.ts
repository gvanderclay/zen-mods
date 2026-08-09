import { bench } from "vitest";

let _result = 0;

bench(
  "retain raw samples",
  () => {
    _result += 1;
  },
  {
    iterations: 5,
    time: 0,
    warmupIterations: 1,
    warmupTime: 0,
  },
);
