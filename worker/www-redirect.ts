// Tiny Worker on www.rafirabo.com: permanently redirects every request to the bare domain, keeping path and query.
export default {
  fetch(request: Request): Response {
    const url = new URL(request.url);
    url.hostname = "rafirabo.com";
    url.protocol = "https:";
    return Response.redirect(url.toString(), 301);
  },
};
