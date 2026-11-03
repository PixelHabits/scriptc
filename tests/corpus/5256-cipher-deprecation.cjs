// A GCM decipher created without authTagLength takes only a 16-byte tag:
// setAuthTag throws for a shorter one. authTagLength admits the shorter
// tag, and no deprecation warning is reported for any of them.
"use strict";
const crypto = require("crypto");

const key = Buffer.alloc(16, 1);
const iv = Buffer.alloc(12, 2);

function attempt(label, run) {
  try {
    console.log(label, run());
  } catch (e) {
    console.log(label, e.name, e.code, e.message);
  }
}

const short = crypto.createCipheriv("aes-128-gcm", key, iv, { authTagLength: 8 });
const shortText = Buffer.concat([short.update("short tag"), short.final()]);
const shortTag = short.getAuthTag();
const full = crypto.createCipheriv("aes-128-gcm", key, iv);
const fullText = Buffer.concat([full.update("full tag"), full.final()]);
const fullTag = full.getAuthTag();
console.log("tag lengths", shortTag.length, fullTag.length);

attempt("8-byte tag", () => crypto.createDecipheriv("aes-128-gcm", key, iv).setAuthTag(shortTag) && "set");
attempt("4-byte tag", () => crypto.createDecipheriv("aes-128-gcm", key, iv).setAuthTag(shortTag.subarray(0, 4)) && "set");
attempt("17-byte tag", () => crypto.createDecipheriv("aes-128-gcm", key, iv).setAuthTag(Buffer.alloc(17)) && "set");
attempt("8-byte tag with authTagLength", () => {
  const decipher = crypto.createDecipheriv("aes-128-gcm", key, iv, { authTagLength: 8 });
  decipher.setAuthTag(shortTag);
  return Buffer.concat([decipher.update(shortText), decipher.final()]).toString();
});
attempt("16-byte tag with authTagLength 8", () =>
  crypto.createDecipheriv("aes-128-gcm", key, iv, { authTagLength: 8 }).setAuthTag(fullTag) && "set",
);
attempt("16-byte tag", () => {
  const decipher = crypto.createDecipheriv("aes-128-gcm", key, iv);
  decipher.setAuthTag(fullTag);
  return Buffer.concat([decipher.update(fullText), decipher.final()]).toString();
});
attempt("setAuthTag twice", () => {
  const decipher = crypto.createDecipheriv("aes-128-gcm", key, iv);
  decipher.setAuthTag(fullTag);
  return decipher.setAuthTag(fullTag) && "set";
});
setTimeout(() => console.log("end of turn"), 0);
