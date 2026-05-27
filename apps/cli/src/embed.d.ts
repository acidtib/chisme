// File-attribute imports (`import x from "./y" with { type: "file" }`) resolve to
// a path string both in dev and inside a `bun build --compile` binary.
declare module "*.md" {
  const path: string;
  export default path;
}
declare module "*.bin" {
  const path: string;
  export default path;
}
