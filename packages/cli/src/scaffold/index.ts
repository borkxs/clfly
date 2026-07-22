export { runInit, type InitOptions, type InitResult } from "./init.js";
export { runAdd, parseCommandPathDsl, type AddOptions, type AddResult } from "./add.js";
export {
  detectPackageManager,
  readProjectValidator,
  type PackageManager,
  type ValidatorKind,
} from "./detect.js";
