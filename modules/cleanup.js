'use strict';

function runCleanup(store, referenceTime) {
  return store.cleanupExpired(referenceTime);
}

function startCleanupScheduler(store, options) {
  const intervalMs = options && options.intervalMs ? options.intervalMs : 5 * 60 * 1000;

  const timer = setInterval(() => {
    runCleanup(store);
  }, intervalMs);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  return {
    stop() {
      clearInterval(timer);
    }
  };
}

module.exports = {
  runCleanup,
  startCleanupScheduler,
};
