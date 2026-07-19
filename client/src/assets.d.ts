declare module "*.blob?url" {
  const url: string;
  export default url;
}

declare module "*.glb?url" {
  const url: string;
  export default url;
}

declare module "*.ogg?url" {
  const url: string;
  export default url;
}

declare const __BUILD_HASH__: string;
