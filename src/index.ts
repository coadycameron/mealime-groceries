import { serve } from "./deps.ts";
import { z } from "./deps.ts";
import MealimeAPI, { CsrfError } from "./mealime-api.ts";

const mealime = new MealimeAPI(
  Deno.env.get("MEALIME_EMAIL"),
  Deno.env.get("MEALIME_PASSWORD"),
);

const handlePostItem = async (request: Request): Promise<Response> => {
  try {
    await mealime.login();
  } catch (_) {
    return new Response("Login failed", { status: 500 });
  }

  let query = "";

  try {
    // Validate input
    const itemResult = z.object({
      item: z.string().min(1),
    }).safeParse(await request.json());
    if (itemResult.success) {
      query = itemResult.data.item;
      const addResult = await mealime.addQuery(query);
      return new Response(addResult.result, { status: 200 });
    } else {
      return new Response(itemResult.error.toString(), { status: 400 });
    }
  } catch (error) {
    if (
      error instanceof CsrfError ||
      error instanceof Deno.errors.PermissionDenied
    ) {
      // retry once
      try {
        console.log("Error while adding item, trying reset");
        await mealime.reset();
        // We know that the validation did not return an error,
        // so item is valid
        const addResult = await mealime.addQuery(query);
        return new Response(addResult.result, { status: 200 });
      } catch (resetError) {
        console.error("Reset didn't work", resetError);
        return new Response("Reset didn't work", { status: 500 });
      }
    }
    console.error("Unexpected error");
    return new Response("Unexpected error", { status: 500 });
  }
};

const handler = async (request: Request): Promise<Response> => {
  const url = new URL(request.url);
  const path = url.pathname;

  // Health check for platform warm-up (no auth required)
  if (request.method === "GET" && (path === "/" || path === "/health")) {
    return new Response("ok", { status: 200 });
  }

  const expectedToken = Deno.env.get("TOKEN");
  if (!expectedToken) {
    console.error("TOKEN env var is missing");
    return new Response("Server misconfigured", { status: 500 });
  }

  const authHeader = request.headers.get("authorization") ??
    request.headers.get("Authorization");

  // Authorize
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    console.log("Request does not include a valid Bearer auth header");
    return new Response("Not Authorized", { status: 401 });
  }

  const providedToken = authHeader.slice("Bearer ".length).trim();
  if (providedToken !== expectedToken) {
    console.log("Request does not include the right auth token");
    return new Response("Not Authorized", { status: 401 });
  }

  // Route to endpoint
  if (request.method === "POST" && path === "/add") {
    return await handlePostItem(request);
  }

  if (request.method === "POST" && path === "/reset") {
    try {
      await mealime.reset();
      return new Response("OK", { status: 200 });
    } catch (error) {
      console.error("Error while resetting ", error);
      return new Response("NOK", { status: 500 });
    }
  }
  return new Response("Not Found", { status: 404 });
};

const port = Number.parseInt(Deno.env.get("PORT") ?? "3000", 10);
console.log(`HTTP webserver running. Listening on port ${port}`);
await serve(handler, { port });
