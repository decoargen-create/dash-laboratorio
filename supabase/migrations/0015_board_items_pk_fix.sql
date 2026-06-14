-- Fix HIGH bug del audit: PK de marketing_board_items era (board_id, ad_id)
-- pero marketing_ads se identifica por (user_id, producto_id, competidor_id,
-- ad_id). Si el mismo ad_id aparece bajo dos competidores del mismo user
-- (raro pero posible — alguno mismo creativo crossposteado), el upsert
-- onConflict='board_id,ad_id' sobreescribía el item original y el JOIN
-- ad-hoc en boards.js (manual filter por producto+competidor) devolvía ad:
-- null silenciosamente para uno de los dos.
--
-- Fix: PK más restrictiva (board_id, producto_id, competidor_id, ad_id).
-- También actualizamos el onConflict en api/marketing/boards.js para hacer
-- match contra esta nueva PK.

alter table public.marketing_board_items
  drop constraint if exists marketing_board_items_pkey;

alter table public.marketing_board_items
  add primary key (board_id, producto_id, competidor_id, ad_id);
