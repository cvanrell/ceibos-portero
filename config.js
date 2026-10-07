// Scanner configuration.
//
// PUBLIC_KEY: the production Ed25519 public key (unpadded base64url, 43 chars),
// copied from the generator page. Until it is filled in, the scanner shows a
// configuration error instead of scanning.
//
// Never paste the TEST key from test-vectors.json here.

export const PLACEHOLDER_PUBLIC_KEY = 'REPLACE_WITH_PRODUCTION_PUBLIC_KEY';

// Production key from the "Ceibos weekend pass" Apps Script project (created 2026-10-07).
export const PUBLIC_KEY = 'DmLkohfyaXowh9QWYjaMnFBM0SaP4as7DYenP0lvmFU';

// The test-only key from test-vectors.json; the app refuses to run with it.
export const TEST_PUBLIC_KEY = 'IiEksVknboFVtfJ3mTcaj6WNx1tSmyXYk7YosrlBPEM';
