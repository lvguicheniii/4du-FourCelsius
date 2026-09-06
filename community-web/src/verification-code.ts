const configuredFixedCode = String(
  import.meta.env.VITE_FIXED_VERIFICATION_CODE || "252616",
).replace(/\D/g, "").slice(0, 6);

export const FIXED_VERIFICATION_CODE =
  configuredFixedCode.length === 6 ? configuredFixedCode : "252616";
