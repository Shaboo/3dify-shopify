export interface GenerationOptions {
  provider: string;
  minImages: number;
  maxImages: number | null;
}
export interface ProductPhoto {
  id: string;
  url: string;
  alt: string | null;
}
export interface Product {
  id: string;
  title: string;
  images: ProductPhoto[];
}
export interface Model {
  id: string;
  status: string;
  outputGlbUrl: string | null;
  outputUsdzUrl: string | null;
  errorMessage: string | null;
  createdAt: string;
  productId?: string | null;
  attachmentStatus?: string | null;
  attachmentError?: string | null;
}
export interface Subscription {
  localTesting?: boolean;
  status: string;
  planName: string | null;
  periodEnd: string | null;
  allowancePeriodStart: string | null;
  allowancePeriodEnd: string | null;
  generationLimit: number;
  generationsConsumed: number;
  pricingUrl: string;
}
export interface ModelPage {
  models: Model[];
  nextCursor: string | null;
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export function backendClient(
  base: string,
  token: () => Promise<string>,
  request: typeof fetch = fetch,
) {
  const origin = new URL(base);
  if (
    origin.protocol !== "https:" &&
    !["localhost", "127.0.0.1"].includes(origin.hostname)
  )
    throw new Error("Backend must use HTTPS");
  const call = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${await token()}`);
    let response = await request(
      `${base.replace(/\/$/, "")}/shopify/api${path}`,
      { ...init, headers },
    );
    if (response.status === 401) {
      headers.set("Authorization", `Bearer ${await token()}`);
      response = await request(
        `${base.replace(/\/$/, "")}/shopify/api${path}`,
        { ...init, headers },
      );
    }
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new ApiError(
        body.message || body.error || `Request failed (${response.status})`,
        response.status,
      );
    }
    return response.json() as Promise<T>;
  };
  return {
    connect: () => call("/connection", { method: "POST" }),
    generationOptions: () => call<GenerationOptions>("/generation-options"),
    subscription: () => call<Subscription>("/subscription"),
    models: (cursor?: string) =>
      call<ModelPage>(
        `/models${cursor ? `?before=${encodeURIComponent(cursor)}` : ""}`,
      ),
    model: (id: string) => call<Model>(`/models/${encodeURIComponent(id)}`),
    productImages: (productId: string) =>
      call<Product>(
        `/products/${encodeURIComponent(productId.split("/").at(-1)!)}/images`,
      ),
    generateProduct: (productId: string, imageIds: string[], key: string) =>
      call<{ jobId: string; status: string }>(
        `/products/${encodeURIComponent(productId.split("/").at(-1)!)}/models`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": key,
          },
          body: JSON.stringify({ imageIds }),
        },
      ),
    generate: (images: File[], key: string, productId?: string) => {
      const body = new FormData();
      images.forEach((image) => body.append("images", image));
      if (productId) body.append("productId", productId);
      return call<{ jobId: string; status: string }>("/models", {
        method: "POST",
        headers: { "Idempotency-Key": key },
        body,
      });
    },
  };
}
export function validateImages(
  images: File[],
  options: GenerationOptions = {
    provider: "meshy",
    minImages: 1,
    maxImages: 4,
  },
) {
  if (
    images.length < options.minImages ||
    (options.maxImages !== null && images.length > options.maxImages) ||
    images.some(
      (x) =>
        !x.size ||
        !["image/jpeg", "image/png", "image/webp"].includes(x.type) ||
        x.size > 20 * 1024 * 1024,
    )
  )
    throw new Error(
      `Choose ${options.maxImages === null ? "one or more" : `${options.minImages}–${options.maxImages}`} JPEG, PNG or WebP photos for ${options.provider}, each up to 20 MB.`,
    );
}
export function pricingDestination(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "admin.shopify.com")
    throw new Error("Invalid Shopify pricing URL");
  return url.href;
}
export function isRunning(model: Model): boolean {
  return (
    !["SUCCESS", "COMPLETED", "FAILED"].includes(model.status) ||
    (!!model.productId &&
      !["attached", "failed", "canceled"].includes(
        model.attachmentStatus || "waiting",
      ))
  );
}
