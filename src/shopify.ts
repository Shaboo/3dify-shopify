type Target = {
  url: string;
  resourceUrl: string;
  parameters: Array<{ name: string; value: string }>;
};
export async function graphql<T>(
  query: string,
  variables: Record<string, unknown>,
  request: typeof fetch = fetch,
): Promise<T> {
  const response = await request("shopify:admin/api/2026-10/graphql.json", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok)
    throw new Error(`Shopify request failed (${response.status})`);
  const body = await response.json();
  if (body.errors?.length)
    throw new Error(
      body.errors.map((x: { message: string }) => x.message).join("; "),
    );
  if (!body.data) throw new Error("Shopify returned no data");
  return body.data;
}
function userErrors(errors: Array<{ message: string }>) {
  if (errors.length) throw new Error(errors.map((x) => x.message).join("; "));
}
export async function attachModel(
  productId: string,
  source: string,
  jobId: string,
  request: typeof fetch = fetch,
) {
  const sourceUrl = new URL(source);
  if (sourceUrl.protocol !== "https:")
    throw new Error("Model download must use HTTPS");
  const response = await request(source, { credentials: "omit" });
  if (!response.ok)
    throw new Error(
      "Could not download generated model. Check model storage CORS.",
    );
  const blob = await response.blob();
  if (!blob.size || blob.size > 500 * 1024 * 1024)
    throw new Error("Model must be between 1 byte and 500 MB");
  const filename = `3dify-${jobId}.glb`;
  const staged = await graphql<{
    stagedUploadsCreate: {
      stagedTargets: Target[];
      userErrors: Array<{ message: string }>;
    };
  }>(
    `
      mutation Stage($input: [StagedUploadInput!]!) {
        stagedUploadsCreate(input: $input) {
          stagedTargets {
            url
            resourceUrl
            parameters {
              name
              value
            }
          }
          userErrors {
            message
          }
        }
      }
    `,
    {
      input: [
        {
          resource: "MODEL_3D",
          filename,
          mimeType: "model/gltf-binary",
          httpMethod: "POST",
          fileSize: String(blob.size),
        },
      ],
    },
    request,
  );
  userErrors(staged.stagedUploadsCreate.userErrors);
  const target = staged.stagedUploadsCreate.stagedTargets[0];
  if (!target) throw new Error("Shopify returned no upload target");
  if (
    new URL(target.url).protocol !== "https:" ||
    new URL(target.resourceUrl).protocol !== "https:"
  )
    throw new Error("Invalid Shopify upload target");
  const form = new FormData();
  for (const parameter of target.parameters)
    form.append(parameter.name, parameter.value);
  form.append("file", blob, filename);
  const upload = await request(target.url, {
    method: "POST",
    body: form,
    credentials: "omit",
  });
  if (!upload.ok) throw new Error(`Model upload failed (${upload.status})`);
  const result = await graphql<{
    productUpdate: {
      product: {
        id: string;
        media: { nodes: Array<{ id: string; alt: string; status: string }> };
      } | null;
      userErrors: Array<{ message: string }>;
    };
  }>(
    `
      mutation Attach(
        $product: ProductUpdateInput!
        $media: [CreateMediaInput!]
      ) {
        productUpdate(product: $product, media: $media) {
          product {
            id
            media(first: 100) {
              nodes {
                id
                alt
                status
              }
            }
          }
          userErrors {
            message
          }
        }
      }
    `,
    {
      product: { id: productId },
      media: [
        {
          originalSource: target.resourceUrl,
          mediaContentType: "MODEL_3D",
          alt: `3dify model ${jobId}`,
        },
      ],
    },
    request,
  );
  userErrors(result.productUpdate.userErrors);
  if (!result.productUpdate.product)
    throw new Error("Shopify did not return the product");
  return result.productUpdate.product;
}
export async function findAttachment(productId: string, jobId: string) {
  let after: string | null = null;
  do {
    const result: {
      product: {
        media: {
          nodes: Array<{ id: string; alt: string; status: string }>;
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
        };
      } | null;
    } = await graphql(
      `
        query Existing($id: ID!, $after: String) {
          product(id: $id) {
            media(first: 100, after: $after) {
              nodes {
                id
                alt
                status
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        }
      `,
      { id: productId, after },
    );
    if (!result.product) throw new Error("Product no longer exists");
    const existing = result.product.media.nodes.find(
      (x) => x.alt === `3dify model ${jobId}`,
    );
    if (existing) return existing;
    after = result.product.media.pageInfo.hasNextPage
      ? result.product.media.pageInfo.endCursor
      : null;
  } while (after);
  return null;
}

export async function waitForAttachment(productId: string, jobId: string) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const media = await findAttachment(productId, jobId);
    if (media && ["READY", "FAILED"].includes(media.status))
      return media.status;
    if (attempt < 11) await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  return "PROCESSING";
}
