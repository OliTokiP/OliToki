/**
 * One version code for Manager, boards, Suite, and Deployer.
 * Prefers TOKI_LIVE_STAMP (what was shipped) then TOKI_BUILD (last git commit).
 */
(function (global) {
  "use strict";
  global.tokiPageVersion = function () {
    var live = global.TOKI_LIVE_STAMP;
    var build = global.TOKI_BUILD;
    var src =
      live && (live.hash || live.hashFull) ? live : build && (build.hash || build.hashFull) ? build : {};
    var full = String(src.hashFull || src.hash || "");
    var hash = full.slice(0, 7);
    return {
      hash: hash,
      hashFull: full,
      subject: src.subject || "",
      date: src.date || "",
      source: src.source || (live && live.hash ? "live" : "git"),
    };
  };
})(window);
