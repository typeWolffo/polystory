declare module "gltf-validator" {
  type Report = { issues: { numErrors: number; numWarnings: number; numInfos: number; messages: { code: string; message: string; severity: number; pointer?: string }[] } };
  const validator: { validateBytes(data: Uint8Array, options?: Record<string, unknown>): Promise<Report> };
  export default validator;
}
