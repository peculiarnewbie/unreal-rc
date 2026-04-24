type Env = {
  ASSETS: { fetch(request: Request): Promise<Response> };
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const assetResponse = await env.ASSETS.fetch(request);
    if (assetResponse.status === 404) {
      return env.ASSETS.fetch(
        new Request(new URL("/index.html", new URL(request.url).origin)),
      );
    }
    return assetResponse;
  },
} satisfies ExportedHandler<Env>;
