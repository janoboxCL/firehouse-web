/// <reference types="@cloudflare/workers-types" />
// Flow redirige el navegador a urlReturn (/rifa/gracias) con un POST — igual
// que hace con el webhook de confirmación — no con un GET normal. Una página
// estática no puede responder a un POST directamente: Cloudflare la rechaza
// con 405 antes de que la petición llegue a la página.
//
// Esta función intercepta ese POST y redirige (303) a la misma URL por GET,
// que sí sirve el archivo estático de /rifa/gracias con normalidad. El GET
// normal simplemente pasa a la página estática sin tocarla (context.next()).

export const onRequestGet: PagesFunction = async (context) => {
  return context.next();
};

export const onRequestPost: PagesFunction = async (context) => {
  const url = new URL(context.request.url);
  return Response.redirect(url.toString(), 303);
};
