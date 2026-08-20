/**
 * The renderer tsconfig does not pull in `vite/client`, so image imports need their own
 * declaration. Scoped to this folder — the web dashboard's tsconfig already gets the same
 * declarations from `types: ["vite/client"]` and must not see a second copy.
 */
declare module "*.png" {
  const src: string;
  export default src;
}
