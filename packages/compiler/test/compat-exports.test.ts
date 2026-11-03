import { expect, test } from "vitest";
import {
  LIB_FN_SIGS,
  libFnSignatures,
  NODE26_FETCH_COMPAT_PROFILE,
  node26FetchCompatProfile,
} from "../src/index.js";

test("the table constants name the tables their functions build", () => {
  expect(LIB_FN_SIGS).toBe(libFnSignatures());
  expect(NODE26_FETCH_COMPAT_PROFILE).toBe(node26FetchCompatProfile());
});
