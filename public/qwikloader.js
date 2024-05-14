/**
 * Set up event listening for browser.
 *
 * Determine all the browser events and set up global listeners for them. If browser triggers event
 * search for the lazy load URL and `import()` it.
 *
 * @param doc - Document to use for setting up global listeners, and to determine all the browser
 *   supported events.
 */
const qwikLoader = (doc, hasInitialized) => {
  const Q_CONTEXT = "__q_context__";
  const win = window;
  const events = new Set();

  // Some shortenings for minification
  const replace = "replace";
  const forEach = "forEach";
  const target = "target";
  const getAttribute = "getAttribute";
  const isConnected = "isConnected";
  const qvisible = "qvisible";
  const Q_JSON = "_qwikjson_";
  const querySelectorAll = (query) => {
    return doc.querySelectorAll(query);
  };

  const isPromise = (promise) => promise && typeof promise.then === "function";

  const broadcast = (infix, ev, type = ev.type) => {
    querySelectorAll("[on" + infix + "\\:" + type + "]")[forEach]((el) =>
      dispatch(el, infix, ev, type)
    );
  };

  const resolveContainer = (containerEl) => {
    if (containerEl[Q_JSON] === undefined) {
      const parentJSON =
        containerEl === doc.documentElement ? doc.body : containerEl;
      let script = parentJSON.lastElementChild;
      while (script) {
        if (
          script.tagName === "SCRIPT" &&
          script[getAttribute]("type") === "qwik/json"
        ) {
          containerEl[Q_JSON] = JSON.parse(
            script.textContent[replace](/\\x3C(\/?script)/gi, "<$1")
          );
          break;
        }
        script = script.previousElementSibling;
      }
    }
  };

  const createEvent = (eventName, detail) =>
    new CustomEvent(eventName, {
      detail,
    });

  const dispatch = async (element, onPrefix, ev, eventName = ev.type) => {
    const attrName = "on" + onPrefix + ":" + eventName;
    if (element.hasAttribute("preventdefault:" + eventName)) {
      ev.preventDefault();
    }
    const ctx = element["_qc_"];
    const relevantListeners = ctx && ctx.li.filter((li) => li[0] === attrName);
    if (relevantListeners && relevantListeners.length > 0) {
      for (const listener of relevantListeners) {
        // listener[1] holds the QRL
        const results = listener[1].getFn(
          [element, ev],
          () => element[isConnected]
        )(ev, element);
        const cancelBubble = ev.cancelBubble;
        if (isPromise(results)) {
          await results;
        }
        // forcing async with await resets ev.cancelBubble to false
        if (cancelBubble) {
          ev.stopPropagation();
        }
      }
      return;
    }
    const attrValue = element[getAttribute](attrName);
    if (attrValue) {
      const container = element.closest("[q\\:container]");
      const qBase = container[getAttribute]("q:base");
      const qVersion = container[getAttribute]("q:version") || "unknown";
      const qManifest = container[getAttribute]("q:manifest-hash") || "dev";
      const base = new URL(qBase, doc.baseURI);
      for (const qrl of attrValue.split("\n")) {
        const url = new URL(qrl, base);
        const href = url.href;
        const symbol = url.hash[replace](/^#?([^?[|]*).*$/, "$1") || "default";
        const reqTime = performance.now();
        let handler;
        let importError;
        let error;
        const isSync = qrl.startsWith("#");
        const eventData = {
          // added
          attrName,
          eventName,
          // ------
          qBase,
          qManifest,
          qVersion,
          href,
          symbol,
          element,
          reqTime,
        };
        if (isSync) {
          handler = (container.qFuncs || [])[Number.parseInt(symbol)];
          if (!handler) {
            importError = "sync";
            error = new Error("sync handler error for symbol: " + symbol);
          }
        } else {
          const uri = url.href.split("#")[0];
          try {
            const module = import(/* @vite-ignore */ uri);
            resolveContainer(container);
            handler = (await module)[symbol];
          } catch (err) {
            importError = "async";
            error = err;
          }
        }
        if (!handler) {
          emitEvent("qerror", { importError, error, ...eventData });
          // break out of the loop if handler is not found
          break;
        }
        const previousCtx = doc[Q_CONTEXT];
        if (element[isConnected]) {
          try {
            doc[Q_CONTEXT] = [element, ev, url];
            isSync || emitEvent("qsymbol", { ...eventData });
            const results = handler(ev, element);
            // only await if there is a promise returned
            if (isPromise(results)) {
              await results;
            }
          } catch (error) {
            emitEvent("qerror", { error, ...eventData });
          } finally {
            doc[Q_CONTEXT] = previousCtx;
          }
        }
      }
    }
  };

  const emitEvent = (eventName, detail) => {
    doc.dispatchEvent(createEvent(eventName, detail));
  };

  const camelToKebab = (str) =>
    str[replace](/([A-Z])/g, (a) => "-" + a.toLowerCase());

  /**
   * Event handler responsible for processing browser events.
   *
   * If browser emits an event, the `eventProcessor` walks the DOM tree looking for corresponding
   * `(${event.type})`. If found the event's URL is parsed and `import()`ed.
   *
   * @param ev - Browser event.
   */
  const processDocumentEvent = async (ev) => {
    // eslint-disable-next-line prefer-const
    let type = camelToKebab(ev.type);
    let element = ev[target];
    broadcast("-document", ev, type);

    while (element && element[getAttribute]) {
      const results = dispatch(element, "", ev, type);
      let cancelBubble = ev.cancelBubble;
      if (isPromise(results)) {
        await results;
      }
      // if another async handler stopPropagation
      cancelBubble =
        cancelBubble ||
        ev.cancelBubble ||
        element.hasAttribute("stoppropagation:" + ev.type);
      element =
        ev.bubbles && cancelBubble !== true ? element.parentElement : null;
    }
  };

  const processWindowEvent = (ev) => {
    broadcast("-window", ev, camelToKebab(ev.type));
  };

  const processReadyStateChange = () => {
    const readyState = doc.readyState;
    if (
      !hasInitialized &&
      (readyState == "interactive" || readyState == "complete")
    ) {
      // document is ready
      hasInitialized = 1;

      emitEvent("qinit");
      const riC = win.requestIdleCallback ?? win.setTimeout;
      riC.bind(win)(() => emitEvent("qidle"));

      if (events.has(qvisible)) {
        const results = querySelectorAll("[on\\:" + qvisible + "]");
        const observer = new IntersectionObserver((entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              observer.unobserve(entry[target]);
              dispatch(entry[target], "", createEvent(qvisible, entry));
            }
          }
        });
        results[forEach]((el) => observer.observe(el));
      }
    }
  };

  const addEventListener = (el, eventName, handler, capture = false) => {
    return el.addEventListener(eventName, handler, { capture, passive: false });
  };

  const push = (eventNames) => {
    for (const eventName of eventNames) {
      if (!events.has(eventName)) {
        addEventListener(doc, eventName, processDocumentEvent, true);
        addEventListener(win, eventName, processWindowEvent, true);
        events.add(eventName);
      }
    }
  };

  if (!(Q_CONTEXT in doc)) {
    // Mark qwik-loader presence but falsy
    doc[Q_CONTEXT] = 0;
    const qwikevents = win.qwikevents;
    // If `qwikEvents` is an array, process it.
    if (Array.isArray(qwikevents)) {
      push(qwikevents);
    }
    // Now rig up `qwikEvents` so we get notified of new registrations by other containers.
    win.qwikevents = {
      push: (...e) => push(e),
    };
    addEventListener(doc, "readystatechange", processReadyStateChange);
    processReadyStateChange();
  }
};

qwikLoader(document);
