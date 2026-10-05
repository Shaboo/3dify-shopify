export interface Model {
  id: string;
  status: string;
  outputGlbUrl: string | null;
  outputUsdzUrl: string | null;
  errorMessage: string | null;
  createdAt: string;
}
export interface Subscription {
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
    subscription: () => call<Subscription>("/subscription"),
    models: (cursor?: string) =>
      call<ModelPage>(
        `/models${cursor ? `?before=${encodeURIComponent(cursor)}` : ""}`,
      ),
    model: (id: string) => call<Model>(`/models/${encodeURIComponent(id)}`),
    generate: (images: File[], key: string) => {
      const body = new FormData();
      body.append("image1", images[0]);
      body.append("image2", images[1]);
      return call<{ jobId: string; status: string }>("/models", {
        method: "POST",
        headers: { "Idempotency-Key": key },
        body,
      });
    },
  };
}
export function validateImages(images: File[]) {
  if (
    images.length !== 2 ||
    images.some(
      (x) =>
        !x.size ||
        !["image/jpeg", "image/png", "image/webp"].includes(x.type) ||
        x.size > 20 * 1024 * 1024,
    )
  )
    throw new Error("Choose two JPEG, PNG or WebP images, each under 20 MB.");
}
export function pricingDestination(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "admin.shopify.com")
    throw new Error("Invalid Shopify pricing URL");
  return url.href;
}
export function isRunning(model: Model): boolean {
  return !["SUCCESS", "COMPLETED", "FAILED"].includes(model.status);
}
