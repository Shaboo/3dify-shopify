interface ImportMeta {
  readonly env: Record<string, string | undefined>;
}
interface Window {
  shopify?: {
    idToken(): Promise<string>;
    resourcePicker(options: {
      type: "product";
      multiple: false;
    }): Promise<Array<{ id: string; title: string }> | undefined>;
  };
}
