const isNodejs =
  typeof process !== 'undefined' && process.versions != null && process.versions.node != null;

export default isNodejs;
