BEGIN;

UPDATE "Settings" AS settings
SET data = jsonb_set(
    settings.data,
    '{channels}',
    (
        SELECT jsonb_agg(jsonb_build_object(
            'id', channel.id,
            'name', channel.name,
            'feeBps', COALESCE(previous.config->'feeBps', '0'::jsonb)
        ) ORDER BY channel.position)
        FROM (VALUES (1, 'WEB', 'Web'), (2, 'WHATSAPP', 'WhatsApp'), (3, 'APPS', 'Apps'))
            AS channel(position, id, name)
        LEFT JOIN LATERAL (
            SELECT entry AS config
            FROM jsonb_array_elements(COALESCE(settings.data->'channels', '[]'::jsonb)) AS old(entry)
            WHERE entry->>'id' = channel.id OR (channel.id = 'APPS' AND entry->>'id' = 'PEDIDOSYA')
            ORDER BY (entry->>'id' = channel.id) DESC
            LIMIT 1
        ) AS previous ON true
    )
)
WHERE id = 1;

UPDATE "Product"
SET config = jsonb_set(config, '{channelPrices}',
    ((config->'channelPrices') - 'PEDIDOSYA') ||
    jsonb_build_object('APPS', COALESCE(config->'channelPrices'->'APPS', config->'channelPrices'->'PEDIDOSYA'))
)
WHERE config->'channelPrices' ? 'PEDIDOSYA';

UPDATE "Product"
SET config = jsonb_set(config, '{promotion,channels}', (
    SELECT jsonb_agg(DISTINCT CASE WHEN entry = 'PEDIDOSYA' THEN 'APPS' ELSE entry END)
    FROM jsonb_array_elements_text(config #> '{promotion,channels}') AS old(entry)
))
WHERE (config #> '{promotion,channels}') ? 'PEDIDOSYA';

COMMIT;
