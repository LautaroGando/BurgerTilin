import './HomeInfo.css'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTruck, faCreditCard, faInfo } from '@fortawesome/free-solid-svg-icons';

export default function HomeInfo({ sendFree }) {

    return (

        <>

            <div className="info-flex">
                <div className="send">
                    <FontAwesomeIcon icon={faTruck} />
                    <p>Envio gratis a partir de los ${sendFree}</p>
                </div>
                <div className="cashout">
                    <FontAwesomeIcon icon={faCreditCard} />
                    <p>Aceptamos Mercado Pago, Efectivo y Transferencia bancaria</p>
                </div>
                <div className="info">
                    <FontAwesomeIcon icon={faInfo} />
                    <p>Registrate para tener beneficios</p>
                </div>
            </div>

        </>

    )

}