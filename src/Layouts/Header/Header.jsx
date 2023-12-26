import './Header.css'
import Logo from '../../assets/icons/icon-logo.png'
import { NavLink } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCartShopping, faUser, faScrewdriverWrench } from '@fortawesome/free-solid-svg-icons'

export default function Header() {

    return (

        <>

            <header>
                <nav>
                    <input className='nav-check-button' type="checkbox" name="checked" id="checked" />
                    <label className='nav-check' htmlFor="checked">
                        <span className='burguer-line'></span>
                    </label>
                    <div className="menu-responsive"></div>
                    <ul>
                        <li>
                            <NavLink to='/menu' className='list-item'>MENU</NavLink>
                        </li>
                        <li>
                            <NavLink to='/about-us' className='list-item'>NOSOTROS</NavLink>
                        </li>
                        <li>
                            <NavLink to='/contact' className='list-item'>CONTACTO</NavLink>
                        </li>
                        <li>
                            <NavLink to='/login-register' className='list-item'>INGRESAR</NavLink>
                        </li>
                        <div>
                            <li>
                                <NavLink to='/admin'>
                                    <button className='admin'>
                                        <FontAwesomeIcon icon={faScrewdriverWrench} />
                                    </button>
                                </NavLink>
                            </li>
                            <li>
                                <button className='cart'>
                                    <FontAwesomeIcon icon={faCartShopping} />
                                </button>
                            </li>
                            <li>
                                <button className='user'>
                                    <FontAwesomeIcon icon={faUser} />
                                </button>
                            </li>
                        </div>
                    </ul>
                    <NavLink to='/home' className='list-image-item'>
                        <img src={Logo} alt="" />
                    </NavLink>
                </nav>
            </header>

        </>

    )

}