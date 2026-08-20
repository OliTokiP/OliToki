/**
 * TokiMenu environment pin. Local default: honor the Settings sheet.
 * Deployer overwrites this file on the restaurant / testing branches.
 */
(function (global) {
  "use strict";
  if (!global.TOKI_ENV) global.TOKI_ENV = "local";
  if (!global.TOKI_DEFAULT_SOURCE) global.TOKI_DEFAULT_SOURCE = "";
  if (!global.TOKI_RESTAURANT_SITE) {
    global.TOKI_RESTAURANT_SITE = "https://olitokip.github.io/OliToki";
  }
  if (!global.TOKI_RESTAURANT_API) {
    global.TOKI_RESTAURANT_API = "https://toki-api-3rx5m3qpzq-uc.a.run.app";
  }
  if (!global.TOKI_TESTING_SITE) {
    global.TOKI_TESTING_SITE = "https://toki-api-testing-3rx5m3qpzq-uc.a.run.app";
  }
  if (!global.TOKI_TESTING_API) {
    global.TOKI_TESTING_API = "https://toki-api-testing-3rx5m3qpzq-uc.a.run.app";
  }
  if (!global.TOKI_API_BASE) {
    if (global.TOKI_ENV === "restaurant") {
      global.TOKI_API_BASE = global.TOKI_RESTAURANT_API;
    } else if (global.TOKI_ENV === "testing" && global.TOKI_TESTING_API) {
      global.TOKI_API_BASE = global.TOKI_TESTING_API;
    } else {
      global.TOKI_API_BASE = global.TOKI_RESTAURANT_API;
    }
  }
})(window);
