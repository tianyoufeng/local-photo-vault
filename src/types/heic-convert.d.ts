declare module "heic-convert" {
  interface ConvertOptions {
    buffer: Uint8Array;
    format: "jpeg" | "png";
    quality?: number;
  }
  export default function convert(opts: ConvertOptions): Promise<ArrayBuffer>;
}
