(function () {
  document.addEventListener("qerror", ({ detail: qEvent }) => {
    console.log("qerror", qEvent);
    debugger;
    navigator.serviceWorker.getRegistration().then(async function (reg) {
      if (reg) {
        const startTime = new Date().getTime();
        console.log("updating service worker");
        await reg.update();
        const endTime = new Date().getTime();
        const timeDiff = endTime - startTime;

        console.log("service worker updated", timeDiff + "ms");
        debugger;
        // force refresh
        location.reload();
      }
    });
  });
})();
