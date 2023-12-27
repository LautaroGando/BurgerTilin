import './HomeBanner.css'
import Banner from '../../assets/images/banner.jpg'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCircleChevronDown } from '@fortawesome/free-solid-svg-icons';

export default function HomeBanner() {

    return (

        <>
        
            <img className='banner' src={Banner} alt="" />
            <div className="look-menu">
                <FontAwesomeIcon icon={faCircleChevronDown} />
                <a href='#'>MIRA NUESTRO MENU</a>
                <FontAwesomeIcon icon={faCircleChevronDown} />
            </div>
        
        </>

    )

}
