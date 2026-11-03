/* WebCrypto's ECDSA, RSASSA-PKCS1-v1_5, RSA-PSS and Ed25519 algorithms:
 * crypto.subtle.generateKey, importKey (spki, pkcs8, jwk, and raw for ECDSA
 * and Ed25519 public keys), exportKey, sign and verify, and the CryptoKey
 * values of these keys. ECDSA keys are on P-256, P-384 and P-521; ECDSA
 * signatures are IEEE P1363 r || s.
 *
 * Argument conversion, algorithm normalization and the DOMException
 * shapes follow Node's lib/internal/crypto/webcrypto.js, ec.js and
 * rsa.js, through the Web IDL helpers of scr_webcrypto.c. The keys and
 * signatures come from the pki unit (scr_pki.c). This unit installs
 * itself into scr_webcrypto.c's dispatch table at startup; the compiler
 * links it when a program uses WebCrypto and names one of these
 * algorithms. All arguments are borrowed. */
#include "scr_runtime.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "scr_pki.h"
#include "scr_webcrypto.h"

typedef enum { SW_ECDSA, SW_RSASSA, SW_PSS, SW_ED25519 } SwKind;

static const char *const sw_names[] = {"ECDSA", "RSASSA-PKCS1-v1_5", "RSA-PSS", "Ed25519"};

static const char *const sw_curves[] = {"P-256", "P-384", "P-521"};

/* ── CryptoKey ────────────────────────────────────────────────────────── */

typedef struct SwKey {
  size_t rc;
  ScrPkiKey *key;
  SwKind kind;
  const char *hash; /* RSA keys: the WebCrypto hash name */
  unsigned usages;
  bool extractable;
  ScrDyn *algorithm; /* cached getter results, or NULL */
  ScrDyn *usage_list;
} SwKey;

static void *sw_key_retain(void *p) {
  ((SwKey *)p)->rc++;
  return p;
}

static void sw_key_release(void *p) {
  SwKey *k = p;
  if (!k || --k->rc != 0) return;
  scr_pki_key_release(k->key);
  if (k->algorithm) scr_dyn_release(k->algorithm);
  if (k->usage_list) scr_dyn_release(k->usage_list);
  free(k);
}

static SwKey *sw_key_of(const ScrDyn *value) {
  if (value->kind != SCR_DYN_HANDLE || value->v.handle.tag != SCR_DYNH_ASYMMETRIC_CRYPTO_KEY) return NULL;
  return value->v.handle.ptr;
}

static bool sw_is_key(const ScrDyn *value) { return sw_key_of(value) != NULL; }

static ScrDyn *sw_key_algorithm(SwKey *k) {
  if (!k->algorithm) {
    ScrDyn *algorithm = scr_dyn_new_obj();
    scr_dyn_obj_set(algorithm, "name", 4, scr_wc_cstr(sw_names[k->kind]));
    if (k->kind == SW_ED25519) {
      /* { name } only */
    } else if (k->kind == SW_ECDSA) {
      scr_dyn_obj_set(algorithm, "namedCurve", 10, scr_wc_cstr(scr_pki_key_curve(k->key)));
    } else {
      scr_dyn_obj_set(algorithm, "modulusLength", 13, scr_dyn_new_num((double)scr_pki_key_bits(k->key)));
      ScrBytes *exponent = scr_pki_key_exponent(k->key);
      scr_dyn_obj_set(algorithm, "publicExponent", 14, scr_dyn_new_bytes(exponent));
      scr_bytes_release(exponent);
      ScrDyn *hash = scr_dyn_new_obj();
      scr_dyn_obj_set(hash, "name", 4, scr_wc_cstr(k->hash));
      scr_dyn_obj_set(algorithm, "hash", 4, hash);
    }
    k->algorithm = algorithm;
  }
  return scr_dyn_retain(k->algorithm);
}

static ScrDyn *sw_usage_array(unsigned usages) {
  ScrDyn *list = scr_dyn_new_arr();
  for (size_t i = 0; i < SCR_WC_COUNT(scr_wc_usages); i++)
    if (usages & (1u << i)) scr_dyn_arr_push(list, scr_wc_cstr(scr_wc_usages[i]));
  return list;
}

static ScrDyn *sw_key_usages(SwKey *k) {
  if (!k->usage_list) k->usage_list = sw_usage_array(k->usages);
  return scr_dyn_retain(k->usage_list);
}

static bool sw_name_is(const char *name, size_t len, const char *literal) {
  return len == strlen(literal) && memcmp(name, literal, len) == 0;
}

static ScrDyn *sw_key_get(void *h, const char *name, size_t len) {
  SwKey *k = h;
  if (sw_name_is(name, len, "type"))
    return scr_wc_cstr(scr_pki_key_is_private(k->key) ? "private" : "public");
  if (sw_name_is(name, len, "extractable")) return scr_dyn_new_bool(k->extractable);
  if (sw_name_is(name, len, "algorithm")) return sw_key_algorithm(k);
  if (sw_name_is(name, len, "usages")) return sw_key_usages(k);
  return NULL;
}

static bool sw_key_set(void *h, const char *name, size_t len, const ScrDyn *value) {
  (void)h;
  (void)value;
  if (!sw_name_is(name, len, "type") && !sw_name_is(name, len, "extractable") &&
      !sw_name_is(name, len, "algorithm") && !sw_name_is(name, len, "usages"))
    return false;
  scr_pki_throw_fmt(SCR_ERR_TYPE, NULL, "Cannot set property %.*s of #<CryptoKey> which has only a getter", (int)len,
                    name);
  return true;
}

static ScrDyn *sw_key_invoke(void *h, ScrDyn *self, const char *method, ScrDyn *const *args, size_t argc,
                             const char *what) {
  (void)h;
  (void)self;
  (void)args;
  (void)argc;
  if (strcmp(method, "toString") == 0) return scr_wc_cstr("[object CryptoKey]");
  scr_pki_throw_fmt(SCR_ERR_TYPE, NULL, "%s is not a function", what);
  return NULL;
}

static ScrDyn *sw_key_symbol_get(void *h, const ScrDyn *key) {
  (void)h;
  if (key->kind != SCR_DYN_SYMBOL || !key->v.symbol.description) return NULL;
  ScrStr *description = key->v.symbol.description(key->v.symbol.value);
  bool tag = description && description->len == 18 && memcmp(description->data, "Symbol.toStringTag", 18) == 0;
  if (description) scr_str_release(description);
  return tag ? scr_wc_cstr("CryptoKey") : NULL;
}

/* As for HMAC CryptoKeys, util.inspect refuses these keys rather than
 * printing a different shape than Node's custom inspector. */
static const ScrDynHandleOps sw_key_ops = {
    .cls = "CryptoKey",
    .retain = sw_key_retain,
    .release = sw_key_release,
    .invoke = sw_key_invoke,
    .get = sw_key_get,
    .set = sw_key_set,
    .json_empty_object = true,
    .to_string_tag = "CryptoKey",
    .symbol_get = sw_key_symbol_get,
};

/* Boxes a CryptoKey over `key` (consumed). */
static ScrDyn *sw_key_new(ScrPkiKey *key, SwKind kind, const char *hash, unsigned usages, bool extractable) {
  static SCR_TL bool installed;
  if (!installed) {
    installed = true;
    scr_dyn_handle_install(SCR_DYNH_ASYMMETRIC_CRYPTO_KEY, &sw_key_ops);
  }
  SwKey *k = calloc(1, sizeof *k);
  if (!k) scr_trap("scriptc: out of memory\n");
  k->rc = 1;
  k->key = key;
  k->kind = kind;
  k->hash = hash;
  k->usages = usages;
  k->extractable = extractable;
  ScrDyn *box = scr_dyn_new_handle(k, SCR_DYNH_ASYMMETRIC_CRYPTO_KEY);
  sw_key_release(k);
  return box;
}

/* ── algorithm parameters ─────────────────────────────────────────────── */

static SwKind sw_kind_of(const char *name) {
  if (strcmp(name, "ECDSA") == 0) return SW_ECDSA;
  if (strcmp(name, "Ed25519") == 0) return SW_ED25519;
  return strcmp(name, "RSA-PSS") == 0 ? SW_PSS : SW_RSASSA;
}

static bool sw_is_rsa_kind(SwKind kind) { return kind == SW_RSASSA || kind == SW_PSS; }

/* The canonical algorithm name of an AlgorithmIdentifier the dispatcher
 * already recognized as one of this unit's algorithms, or NULL with the
 * error pending. */
static const char *sw_algorithm_name(ScrDyn *identifier) {
  ScrStr *name = scr_wc_algorithm_name(identifier, "Algorithm");
  if (!name) return NULL;
  const char *found = scr_wc_lookup(sw_names, SCR_WC_COUNT(sw_names), name);
  scr_str_release(name);
  if (!found) scr_throw_domex("NotSupportedError", "Unrecognized algorithm name");
  return found;
}

/* A required dictionary member (+1), or NULL with ERR_MISSING_OPTION. */
static ScrDyn *sw_required(ScrDyn *plain, const char *dict, const char *member) {
  ScrDyn *v = scr_wc_member(plain, member);
  if (v->kind == SCR_DYN_UNDEF) {
    scr_dyn_release(v);
    scr_wc_missing_member(dict, member);
    return NULL;
  }
  return v;
}

/* namedCurve (DOMString, required) converted (+1), or NULL with the
 * error pending. */
static ScrStr *sw_named_curve(ScrDyn *plain, const char *dict) {
  ScrDyn *value = sw_required(plain, dict, "namedCurve");
  if (!value) return NULL;
  ScrStr *s = scr_wc_dom_string(value);
  scr_dyn_release(value);
  return s;
}

/* namedCurveValidator over the implemented curves: the curve, or NULL with
 * the error pending. */
static const char *sw_curve(const ScrStr *name) {
  for (size_t i = 0; i < SCR_WC_COUNT(sw_curves); i++)
    if (name->len == strlen(sw_curves[i]) && memcmp(name->data, sw_curves[i], name->len) == 0) return sw_curves[i];
  scr_throw_domex("NotSupportedError", "Unrecognized namedCurve");
  return NULL;
}

/* A dictionary whose only member is the required hash: converted, then
 * normalized. */
static const char *sw_hash(ScrDyn *plain, const char *dict, const char *method) {
  ScrDyn *hash = scr_wc_hash_convert(plain, dict);
  if (!hash) return NULL;
  const char *canonical = scr_wc_hash_member(hash, dict, method);
  scr_dyn_release(hash);
  return canonical;
}

/* An [EnforceRange] unsigned long member; false with the TypeError
 * pending. */
static bool sw_unsigned_long(ScrDyn *value, const char *member, double *out) {
  double x;
  if (!scr_dyn_number_coerce_js(value, &x)) return false;
  if (x != x || x == 1.0 / 0.0 || x == -1.0 / 0.0) {
    scr_wc_type_error("ERR_INVALID_ARG_TYPE", "%s: %s in passed algorithm is not a finite number.",
                      scr_wc_normalize_prefix, member);
    return false;
  }
  x = trunc(x);
  if (x < 0 || x > 4294967295.0) {
    scr_wc_type_error("ERR_OUT_OF_RANGE",
                      "%s: %s in passed algorithm is outside the expected range of 0 to 4294967295.",
                      scr_wc_normalize_prefix, member);
    return false;
  }
  *out = x == 0 ? 0 : x;
  return true;
}

static void sw_unsupported_usage(SwKind kind) {
  char message[96];
  snprintf(message, sizeof message, "Unsupported key usage for %s key", sw_names[kind]);
  scr_throw_domex("SyntaxError", message);
}

/* ── generateKey ──────────────────────────────────────────────────────── */

static ScrPromise *sw_generate_key(const ScrDyn *args) {
  static const char prefix[] = "Failed to execute 'generateKey' on 'SubtleCrypto'";
  if (!scr_wc_required(prefix, args, 3)) return scr_wc_rejected();
  ScrWcArgs a;
  scr_wc_args_take(&a, args, 3);
  ScrDyn *pair = NULL;
  ScrDyn *plain = NULL;
  ScrStr *curve_name = NULL;
  ScrBytes *exponent = NULL;
  if (!scr_wc_is_object(a.v[0])) {
    ScrStr *s = scr_wc_dom_string(a.v[0]);
    if (!s) goto done;
    scr_str_release(s);
  }
  bool extractable = scr_dyn_truthy(a.v[1]);
  long usages = scr_wc_key_usages(prefix, 2, a.v[2]);
  if (usages < 0) goto done;
  const char *name = sw_algorithm_name(a.v[0]);
  if (!name) goto done;
  SwKind kind = sw_kind_of(name);
  plain = scr_wc_plain(a.v[0]);
  if (!plain) goto done;
  const char *hash = NULL;
  double bits = 0;
  if (kind == SW_ED25519) {
    /* no parameters */
  } else if (kind == SW_ECDSA) {
    if (!scr_wc_is_object(plain)) {
      scr_wc_missing_member("EcKeyGenParams", "namedCurve");
      goto done;
    }
    curve_name = sw_named_curve(plain, "EcKeyGenParams");
    if (!curve_name) goto done;
  } else {
    static const char dict[] = "RsaHashedKeyGenParams";
    if (!scr_wc_is_object(plain)) {
      scr_wc_missing_member(dict, "hash");
      goto done;
    }
    /* Dictionary members convert in name order: hash, modulusLength,
     * publicExponent; then the hash normalizes. */
    ScrDyn *hash_value = scr_wc_hash_convert(plain, dict);
    if (!hash_value) goto done;
    ScrDyn *length = sw_required(plain, dict, "modulusLength");
    bool ok = length && sw_unsigned_long(length, "modulusLength", &bits);
    if (length) scr_dyn_release(length);
    ScrDyn *e = ok ? sw_required(plain, dict, "publicExponent") : NULL;
    if (e && (e->kind != SCR_DYN_BYTES || e->v.bytes->elem != SCR_BYTES_U8)) {
      scr_wc_type_error("ERR_INVALID_ARG_TYPE", "%s: publicExponent in passed algorithm is not instance of Uint8Array.",
                        scr_wc_normalize_prefix);
    } else if (e) {
      exponent = scr_bytes_buffer_source(e);
      hash = scr_wc_hash_member(hash_value, dict, "generateKey");
    }
    if (e) scr_dyn_release(e);
    scr_dyn_release(hash_value);
    if (!hash) goto done;
  }
  if (usages & ~(long)(SCR_WC_USAGE_SIGN | SCR_WC_USAGE_VERIFY)) {
    sw_unsupported_usage(kind);
    goto done;
  }
  ScrPkiKey *key;
  if (kind == SW_ED25519) {
    key = scr_pki_generate_ed25519();
    if (!key) goto done;
  } else if (kind == SW_ECDSA) {
    const char *curve = sw_curve(curve_name);
    if (!curve) goto done;
    key = scr_pki_generate_ec(curve);
  } else {
    /* The RsaKeyGenParams validators: modulusLength, then publicExponent
     * as bigIntArrayToUnsignedInt reads it (big-endian, nonzero bytes
     * only in its low four). */
    if (bits < 512) {
      scr_throw_domex("OperationError", "algorithm.modulusLength must be at least 512");
      goto done;
    }
    size_t n = (size_t)scr_bytes_byte_len(exponent);
    uint32_t value = 0;
    for (size_t i = 0; i < n; i++) {
      if (n - i - 1 >= 4 && exponent->data[i]) {
        scr_throw_domex("OperationError", "algorithm.publicExponent must fit in an unsigned 32-bit integer");
        goto done;
      }
      value = (value << 8) | exponent->data[i];
    }
    if (value < 3) {
      scr_throw_domex("OperationError", "algorithm.publicExponent must be at least 3");
      goto done;
    }
    if ((value & 1) == 0) {
      scr_throw_domex("OperationError", "algorithm.publicExponent must be odd");
      goto done;
    }
    /* The pki unit's numbers hold moduli up to 8192 bits. */
    if (bits > 8192) {
      scr_wc_unsupported("generateKey", "this RSA modulus length");
      goto done;
    }
    key = scr_pki_generate_rsa((unsigned)bits, value);
  }
  if (!key) {
    scr_throw_domex("OperationError", "Key generation failed");
    goto done;
  }
  unsigned private_usages = (unsigned)usages & SCR_WC_USAGE_SIGN;
  unsigned public_usages = (unsigned)usages & SCR_WC_USAGE_VERIFY;
  if (private_usages == 0) {
    scr_pki_key_release(key);
    scr_throw_domex("SyntaxError", "Usages cannot be empty when creating a key.");
    goto done;
  }
  ScrPkiKey *public_key = scr_pki_key_public_of(key);
  if (!public_key) {
    scr_pki_key_release(key);
    scr_throw_domex("OperationError", "Key generation failed");
    goto done;
  }
  pair = scr_dyn_new_obj();
  scr_dyn_obj_set(pair, "publicKey", 9, sw_key_new(public_key, kind, hash, public_usages, true));
  scr_dyn_obj_set(pair, "privateKey", 10, sw_key_new(key, kind, hash, private_usages, extractable));
done:
  if (exponent) scr_bytes_release(exponent);
  if (curve_name) scr_str_release(curve_name);
  if (plain) scr_dyn_release(plain);
  scr_wc_args_drop(&a, 3);
  if (!pair) return scr_wc_rejected();
  ScrPromise *p = scr_promise_new();
  scr_crypto_defer_dyn(pair, NULL, scr_crypto_promise_callback(p), scr_crypto_promise_settle_dyn);
  return p;
}

/* ── importKey ────────────────────────────────────────────────────────── */

/* A JWK string member, or NULL. */
static const ScrDyn *sw_jwk_member(const ScrDyn *jwk, const char *key) {
  const ScrDyn *v = scr_dyn_obj_get(jwk, key, strlen(key));
  return v && v->kind != SCR_DYN_UNDEF ? v : NULL;
}

static bool sw_jwk_is(const ScrDyn *v, const char *text) {
  return v && v->kind == SCR_DYN_STR && v->v.str->len == strlen(text) &&
         memcmp(v->v.str->data, text, v->v.str->len) == 0;
}

/* The JWK "alg" an RSA key with this hash carries ("RS256", "PS384"). */
static void sw_rsa_jwk_alg(SwKind kind, const char *hash, char out[8]) {
  const char *bits = strcmp(hash, "SHA-1") == 0 ? "1" : hash + 4;
  snprintf(out, 8, "%s%s", kind == SW_PSS ? "PS" : "RS", bits);
}

static ScrDyn *sw_import(const ScrDyn *args) {
  static const char prefix[] = "Failed to execute 'importKey' on 'SubtleCrypto'";
  if (!scr_wc_required(prefix, args, 5)) return NULL;
  ScrWcArgs a;
  scr_wc_args_take(&a, args, 5);
  ScrDyn *result = NULL;
  ScrBytes *data = NULL;
  ScrWcJwk key_data;
  memset(&key_data, 0, sizeof key_data);
  ScrDyn *plain = NULL;
  ScrStr *curve_name = NULL;
  const char *format = scr_wc_key_format(prefix, a.v[0]);
  if (!format || !scr_wc_key_data(prefix, a.v[1], &data, &key_data)) goto done;
  bool is_jwk = strcmp(format, "jwk") == 0;
  const ScrDyn *jwk = key_data.dict;
  if (!scr_wc_is_object(a.v[2])) {
    ScrStr *s = scr_wc_dom_string(a.v[2]);
    if (!s) goto done;
    scr_str_release(s);
  }
  bool extractable = scr_dyn_truthy(a.v[3]);
  long usages = scr_wc_key_usages(prefix, 4, a.v[4]);
  if (usages < 0) goto done;
  const char *name = sw_algorithm_name(a.v[2]);
  if (!name) goto done;
  SwKind kind = sw_kind_of(name);
  plain = scr_wc_plain(a.v[2]);
  if (!plain) goto done;
  const char *curve = NULL;
  const char *hash = NULL;
  if (kind == SW_ED25519) {
    /* no parameters */
  } else if (kind == SW_ECDSA) {
    if (!scr_wc_is_object(plain)) {
      scr_wc_missing_member("EcKeyImportParams", "namedCurve");
      goto done;
    }
    curve_name = sw_named_curve(plain, "EcKeyImportParams");
    if (!curve_name) goto done;
  } else {
    if (!scr_wc_is_object(plain)) {
      scr_wc_missing_member("RsaHashedImportParams", "hash");
      goto done;
    }
    hash = sw_hash(plain, "RsaHashedImportParams", "importKey");
    if (!hash) goto done;
  }
  if (!scr_wc_key_data_matches(format, a.v[1], &key_data)) goto done;
  if (curve_name && !(curve = sw_curve(curve_name))) goto done;
  bool private_key;
  if (is_jwk) {
    private_key = sw_jwk_member(jwk, "d") != NULL;
  } else if (strcmp(format, "pkcs8") == 0) {
    private_key = true;
  } else if (strcmp(format, "spki") == 0 ||
             ((kind == SW_ECDSA || kind == SW_ED25519) && strcmp(format, "raw") == 0)) {
    private_key = false;
  } else {
    char message[96];
    snprintf(message, sizeof message, "Unable to import %s using %s format", sw_names[kind], format);
    scr_throw_domex("NotSupportedError", message);
    goto done;
  }
  unsigned allowed = private_key ? SCR_WC_USAGE_SIGN : SCR_WC_USAGE_VERIFY;
  ScrPkiKey *key = NULL;
  /* An Ed25519 private key derives its public key in the Ed25519 unit. */
  if (kind == SW_ED25519 && private_key && !scr_pki_ed25519_ready()) goto done;
  if (is_jwk) {
    /* The key type's import: usages, validateJwk, then crv and alg. */
    if ((unsigned)usages & ~allowed) {
      sw_unsupported_usage(kind);
      goto done;
    }
    const char *kty = kind == SW_ECDSA ? "EC" : kind == SW_ED25519 ? "OKP" : "RSA";
    if (!scr_wc_validate_jwk(&key_data, kty, extractable, usages, "sig")) goto done;
    if (kind == SW_ECDSA && !sw_jwk_is(sw_jwk_member(jwk, "crv"), curve)) {
      scr_throw_domex("DataError", "JWK \"crv\" does not match the requested algorithm");
      goto done;
    }
    if (kind == SW_ED25519 && !sw_jwk_is(sw_jwk_member(jwk, "crv"), "Ed25519")) {
      scr_throw_domex("DataError", "JWK \"crv\" Parameter and algorithm name mismatch");
      goto done;
    }
    const ScrDyn *alg = sw_jwk_member(jwk, "alg");
    if (kind == SW_ECDSA && alg) {
      const char *alg_curve = sw_jwk_is(alg, "ES256")   ? "P-256"
                              : sw_jwk_is(alg, "ES384") ? "P-384"
                              : sw_jwk_is(alg, "ES512") ? "P-521"
                                                        : NULL;
      if (!alg_curve || strcmp(alg_curve, curve) != 0) {
        scr_throw_domex("DataError", "JWK \"alg\" does not match the requested algorithm");
        goto done;
      }
    }
    if (kind == SW_ED25519 && alg && !sw_jwk_is(alg, "Ed25519") && !sw_jwk_is(alg, "EdDSA")) {
      scr_throw_domex("DataError", "JWK \"alg\" does not match the requested algorithm");
      goto done;
    }
    if (sw_is_rsa_kind(kind) && alg) {
      char expected[8];
      sw_rsa_jwk_alg(kind, hash, expected);
      if (!sw_jwk_is(alg, expected)) {
        scr_throw_domex("DataError", "JWK \"alg\" does not match the requested algorithm");
        goto done;
      }
    }
    key = scr_pki_key_from_jwk(jwk, private_key);
  } else {
    if ((unsigned)usages & ~allowed) {
      sw_unsupported_usage(kind);
      goto done;
    }
    ScrBytes *view = data;
    SCR_BYTES_SNAPSHOT(view);
    size_t len = (size_t)scr_bytes_byte_len(view);
    if (strcmp(format, "raw") == 0)
      key = kind == SW_ED25519 ? scr_pki_key_from_ed25519_raw(view->data, len)
                               : scr_pki_key_from_point(curve, view->data, len);
    else key = scr_pki_key_parse_der(view->data, len, private_key);
  }
  if (!key) {
    scr_throw_domex("DataError", "Invalid keyData");
    goto done;
  }
  bool key_matches = kind == SW_ED25519 ? scr_pki_key_is_ed25519(key)
                     : kind == SW_ECDSA  ? !scr_pki_key_is_rsa(key) && !scr_pki_key_is_ed25519(key)
                                         : scr_pki_key_is_rsa(key);
  if (!key_matches) {
    scr_pki_key_release(key);
    scr_throw_domex("DataError", "Invalid key type");
    goto done;
  }
  if (kind == SW_ECDSA && strcmp(scr_pki_key_curve(key), curve) != 0) {
    scr_pki_key_release(key);
    scr_throw_domex("DataError", "Named curve mismatch");
    goto done;
  }
  if (private_key && usages == 0) {
    scr_pki_key_release(key);
    scr_throw_domex("SyntaxError", "Usages cannot be empty when importing a private key.");
    goto done;
  }
  result = sw_key_new(key, kind, hash, (unsigned)usages, extractable);
done:
  if (data) scr_bytes_release(data);
  scr_wc_jwk_drop(&key_data);
  if (plain) scr_dyn_release(plain);
  if (curve_name) scr_str_release(curve_name);
  scr_wc_args_drop(&a, 5);
  return result;
}

static ScrPromise *sw_import_key(const ScrDyn *args) {
  ScrDyn *key = sw_import(args);
  if (!key) return scr_wc_rejected();
  return scr_promise_settled_ref(key, &scr_dyn_retain_v, &scr_dyn_release_v, NULL);
}

/* ── exportKey ────────────────────────────────────────────────────────── */

static ScrDyn *sw_array_buffer(ScrBytes *bytes) {
  ScrDyn *out = scr_array_buffer_from_bytes(bytes);
  scr_bytes_release(bytes);
  return out;
}

static ScrDyn *sw_export(const ScrDyn *args) {
  ScrWcArgs a;
  scr_wc_args_take(&a, args, 2);
  ScrDyn *result = NULL;
  const char *format = scr_wc_key_format("Failed to execute 'exportKey' on 'SubtleCrypto'", a.v[0]);
  SwKey *k = sw_key_of(a.v[1]);
  bool private_key = scr_pki_key_is_private(k->key);
  if (!format) goto done;
  if (!k->extractable) {
    scr_throw_domex("InvalidAccessError", "key is not extractable");
    goto done;
  }
  if (strcmp(format, "spki") == 0 || strcmp(format, "pkcs8") == 0) {
    bool want_private = strcmp(format, "pkcs8") == 0;
    if (want_private != private_key) {
      scr_throw_domex("InvalidAccessError", want_private ? "Key must be a private key" : "Key must be a public key");
      goto done;
    }
    ScrBytes *der = scr_pki_export_der(k->key);
    if (!der) {
      scr_throw_domex("OperationError", "Failed to export key");
      goto done;
    }
    result = sw_array_buffer(der);
  } else if (strcmp(format, "raw") == 0 && (k->kind == SW_ECDSA || k->kind == SW_ED25519)) {
    if (private_key) {
      scr_throw_domex("InvalidAccessError", "Key must be a public key");
      goto done;
    }
    ScrBytes *point = k->kind == SW_ED25519 ? scr_pki_export_ed25519_raw(k->key) : scr_pki_export_point(k->key);
    if (!point) {
      scr_throw_domex("OperationError", "Failed to export key");
      goto done;
    }
    result = sw_array_buffer(point);
  } else if (strcmp(format, "jwk") == 0) {
    ScrDyn *members = scr_pki_export_jwk(k->key);
    ScrDyn *jwk = scr_dyn_new_obj();
    scr_dyn_obj_set(jwk, "key_ops", 7, sw_usage_array(k->usages));
    scr_dyn_obj_set(jwk, "ext", 3, scr_dyn_new_bool(k->extractable));
    if (sw_is_rsa_kind(k->kind)) {
      char alg[8];
      sw_rsa_jwk_alg(k->kind, k->hash, alg);
      scr_dyn_obj_set(jwk, "alg", 3, scr_wc_cstr(alg));
    } else if (k->kind == SW_ED25519) {
      scr_dyn_obj_set(jwk, "alg", 3, scr_wc_cstr("Ed25519"));
    }
    /* The key members in Node's order for each key type. */
    static const char *const rsa_names[] = {"kty", "n", "e", "d", "p", "q", "dp", "dq", "qi"};
    static const char *const ec_names[] = {"kty", "x", "y", "crv", "d"};
    static const char *const okp_names[] = {"kty", "crv", "x", "d"};
    const char *const *names = sw_is_rsa_kind(k->kind) ? rsa_names : k->kind == SW_ED25519 ? okp_names : ec_names;
    size_t count = sw_is_rsa_kind(k->kind) ? SCR_WC_COUNT(rsa_names)
                   : k->kind == SW_ED25519 ? SCR_WC_COUNT(okp_names)
                                           : SCR_WC_COUNT(ec_names);
    for (size_t i = 0; i < count; i++) {
      const ScrDyn *v = scr_dyn_obj_get(members, names[i], strlen(names[i]));
      if (v) scr_dyn_obj_set(jwk, names[i], strlen(names[i]), scr_dyn_retain((ScrDyn *)v));
    }
    scr_dyn_release(members);
    result = jwk;
  } else {
    char message[128];
    snprintf(message, sizeof message, "Unable to export %s %s key using %s format", sw_names[k->kind],
             private_key ? "private" : "public", format);
    scr_throw_domex("NotSupportedError", message);
  }
done:
  scr_wc_args_drop(&a, 2);
  return result;
}

static ScrPromise *sw_export_key(const ScrDyn *args) {
  ScrDyn *value = sw_export(args);
  if (!value) return scr_wc_rejected();
  return scr_promise_settled_ref(value, &scr_dyn_retain_v, &scr_dyn_release_v, NULL);
}

/* ── sign and verify ──────────────────────────────────────────────────── */

/* The deferred verify result: a dyn boolean. */
static void sw_settle_verified(ScrClosure *cb, ScrError *error, ScrBytes *value) {
  (void)error;
  ScrPromise *p;
  memcpy(&p, &cb->caps[0]->slot, sizeof p);
  ScrDyn *verified = (ScrDyn *)value;
  scr_promise_fulfill_bool(p, scr_dyn_truthy(verified));
  scr_dyn_release(verified);
}

static ScrPromise *sw_sign_verify(const ScrDyn *args, bool verify) {
  const char *prefix = verify ? "Failed to execute 'verify' on 'SubtleCrypto'"
                              : "Failed to execute 'sign' on 'SubtleCrypto'";
  const char *method = verify ? "verify" : "sign";
  size_t n = verify ? 4 : 3;
  if (!scr_wc_required(prefix, args, n)) return scr_wc_rejected();
  ScrWcArgs a;
  scr_wc_args_take(&a, args, n);
  ScrPromise *result = NULL;
  ScrBytes *data = NULL;
  ScrBytes *signature = NULL;
  ScrDyn *plain = NULL;
  if (!scr_wc_is_object(a.v[0])) {
    ScrStr *s = scr_wc_dom_string(a.v[0]);
    if (!s) goto done;
    scr_str_release(s);
  }
  SwKey *k = sw_key_of(a.v[1]);
  if (!k && !scr_webcrypto_is_crypto_key(a.v[1])) {
    scr_wc_type_error("ERR_INVALID_ARG_TYPE", "%s: 2nd argument is not of type CryptoKey.", prefix);
    goto done;
  }
  if (verify) {
    signature = scr_wc_buffer_source(prefix, 2, a.v[2]);
    if (!signature) goto done;
  }
  data = scr_wc_buffer_source(prefix, verify ? 3 : 2, a.v[verify ? 3 : 2]);
  if (!data) goto done;
  const char *name = sw_algorithm_name(a.v[0]);
  if (!name) goto done;
  SwKind kind = sw_kind_of(name);
  plain = scr_wc_plain(a.v[0]);
  if (!plain) goto done;
  const char *hash = NULL;
  int salt = 0;
  if (kind == SW_ED25519) {
    /* no parameters */
  } else if (kind == SW_ECDSA) {
    if (!scr_wc_is_object(plain)) {
      scr_wc_missing_member("EcdsaParams", "hash");
      goto done;
    }
    hash = sw_hash(plain, "EcdsaParams", method);
    if (!hash) goto done;
  } else if (kind == SW_PSS) {
    if (!scr_wc_is_object(plain)) {
      scr_wc_missing_member("RsaPssParams", "saltLength");
      goto done;
    }
    ScrDyn *value = sw_required(plain, "RsaPssParams", "saltLength");
    if (!value) goto done;
    double x;
    bool ok = sw_unsigned_long(value, "saltLength", &x);
    scr_dyn_release(value);
    if (!ok) goto done;
    salt = x > 65536 ? 65536 : (int)x;
  }
  if (!k || k->kind != kind) {
    scr_throw_domex("InvalidAccessError", "Key algorithm mismatch");
    goto done;
  }
  if (!(k->usages & (verify ? SCR_WC_USAGE_VERIFY : SCR_WC_USAGE_SIGN))) {
    char message[64];
    snprintf(message, sizeof message, "Unable to use this key to %s", method);
    scr_throw_domex("InvalidAccessError", message);
    goto done;
  }
  if (sw_is_rsa_kind(kind)) hash = k->hash;
  if (kind == SW_ED25519 && !scr_pki_ed25519_ready()) goto done;
  {
    ScrBytes *view = data;
    SCR_BYTES_SNAPSHOT(view);
    size_t len = (size_t)scr_bytes_byte_len(view);
    if (verify) {
      ScrBytes *sig = signature;
      SCR_BYTES_SNAPSHOT(sig);
      bool ok = scr_pki_verify(k->key, hash, kind == SW_PSS, salt, view->data, len, sig->data,
                               (size_t)scr_bytes_byte_len(sig));
      result = scr_promise_new();
      scr_crypto_defer_dyn(scr_dyn_new_bool(ok), NULL, scr_crypto_promise_callback(result), sw_settle_verified);
    } else {
      ScrBytes *out = scr_pki_sign(k->key, hash, kind == SW_PSS, salt, view->data, len);
      if (!out) {
        scr_throw_domex("OperationError", "Failed to sign");
        goto done;
      }
      result = scr_promise_new();
      scr_crypto_defer_bytes(out, NULL, scr_crypto_promise_callback(result), scr_crypto_promise_settle_array_buffer);
    }
  }
done:
  if (data) scr_bytes_release(data);
  if (signature) scr_bytes_release(signature);
  if (plain) scr_dyn_release(plain);
  scr_wc_args_drop(&a, n);
  return result ? result : scr_wc_rejected();
}

static ScrPromise *sw_sign(const ScrDyn *args) { return sw_sign_verify(args, false); }

static ScrPromise *sw_verify(const ScrDyn *args) { return sw_sign_verify(args, true); }

static const ScrWcAsymmetric sw_table = {
    .generate_key = sw_generate_key,
    .import_key = sw_import_key,
    .export_key = sw_export_key,
    .sign = sw_sign,
    .verify = sw_verify,
    .is_key = sw_is_key,
};

/* Installed before main: scr_webcrypto.c dispatches these algorithms
 * here. */
__attribute__((constructor)) static void sw_install(void) { scr_wc_asymmetric = &sw_table; }
