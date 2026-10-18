const fs = require("node:fs");

function retry(run, attempt = 0) {
  return run().catch((error) => {
    if (!error || (error.code !== "EBUSY" && error.code !== "EPERM") || attempt >= 25) {
      throw error;
    }
    return new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1))).then(() =>
      retry(run, attempt + 1),
    );
  });
}

const rename = fs.promises.rename.bind(fs.promises);
fs.promises.rename = (from, to) => retry(() => rename(from, to));

const renameSync = fs.renameSync.bind(fs);
fs.renameSync = (from, to) => {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    try {
      return renameSync(from, to);
    } catch (error) {
      if (!error || (error.code !== "EBUSY" && error.code !== "EPERM") || attempt === 24) throw error;
      const until = Date.now() + 150 * (attempt + 1);
      while (Date.now() < until) {
        // Windows can briefly lock a file it just wrote.
      }
    }
  }
};
