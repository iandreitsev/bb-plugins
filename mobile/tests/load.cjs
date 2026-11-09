const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), ts = require("typescript");
module.exports = function loader(w) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const exports = {}; cache.set(file, exports);
    const source = fs.readFileSync(path.join(__dirname, "..", file + ".ts"), "utf8");
    const code = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true}}).outputText;
    const globals = { exports, queueMicrotask, console, window: w, document: w.document, location: w.location,
      require: name => name.startsWith("./") ? load(name.slice(2)) : require(name) };
    for (const key of ["CustomEvent", "Event", "Node", "Element", "HTMLElement", "HTMLButtonElement", "MutationObserver"]) globals[key] = w[key];
    vm.runInNewContext(code, globals); return exports;
  }
  return load;
};
