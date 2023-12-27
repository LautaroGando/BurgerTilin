import './Footer.css';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPhone, faEnvelope } from '@fortawesome/free-solid-svg-icons';
import { faInstagram } from '@fortawesome/free-brands-svg-icons';
import LogoFooter from '../../assets/icons/icon-logo-footer.png';

export default function Footer({ year }) {

    return (

        <>

            <footer>
                <div className="copy">
                    <p>Copyright&copy; BurgerTilin {year}</p>
                </div>
                <div className="contact">
                    <div className="phone">
                        <FontAwesomeIcon icon={faPhone} />
                        <a href="tel:+1132692245">11-3269-2245</a>
                    </div>
                    <div className="instagram">
                        <FontAwesomeIcon icon={faInstagram} />
                        <a href="#">@BurgerTilin</a>
                    </div>
                    <div className="email">
                        <FontAwesomeIcon icon={faEnvelope} />
                        <a href="mailto:burgertilin@gmail.com">burgertilin@gmail.com</a>
                    </div>
                </div>
                <div className="img-logo">
                    <img src={LogoFooter} alt="" />
                </div>
            </footer>

        </>

    );

};
