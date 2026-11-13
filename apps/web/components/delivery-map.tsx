import Image from 'next/image';

export default function DeliveryMap() {
  return (
    <>
      <svg width="0" height="0" aria-hidden="true" style={{ position: 'absolute' }}>
        <filter id="delivery-map-gold" colorInterpolationFilters="sRGB">
          {/* Shift the orange accents toward gold without tinting the streets or text. */}
          <feColorMatrix
            in="SourceGraphic"
            type="matrix"
            values="0 0 0 0 0  .7 -.7 0 0 -.08  0 0 0 0 0  0 0 0 1 0"
            result="goldAccent"
          />
          <feComposite in="SourceGraphic" in2="goldAccent" operator="arithmetic" k2="1" k3="1" />
        </filter>
      </svg>
      <Image
        className="shop-delivery-map"
        src="/assets/zona-delivery-burger-tilin.png"
        width={1013}
        height={756}
        unoptimized
        alt="Mapa de Burger Tilín con la zona de envío gratis. Incluye partes de Versalles, Monte Castro y Villa Luro."
      />
    </>
  );
}
