// Browser-side shim for Node's "stream" module.
// xlsx-js-style references `stream.Readable` only for Node-only code paths
// (reading workbooks from a Node Readable). In the browser we never hit those
// paths, but Vite would still print a "Module stream has been externalized"
// warning at module init. Providing an inert shim silences the warning
// without changing behavior.
class Readable {
  // no-op — never instantiated in the browser path
}
export { Readable };
export default { Readable };
