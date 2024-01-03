import './HomeWpp.css'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faWhatsapp } from '@fortawesome/free-brands-svg-icons';

export default function HomeWpp() {

    return (

        <>

            <a className='wppLink' href="https://w.app/burgertilin" target="_blank">
                <FontAwesomeIcon icon={faWhatsapp} />
            </a>

        </>

    )

}