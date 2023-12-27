import React, { useState } from 'react';
import './Header.css';
import Logo from '../../assets/icons/icon-logo.png';
import { NavLink } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCartShopping, faUser, faScrewdriverWrench } from '@fortawesome/free-solid-svg-icons';

export default function Header() {

    const [isMenuOpen, setMenuOpen] = useState(false);

    const handleMenuToggle = () => {

        setMenuOpen(!isMenuOpen);

    };

    const closeMenu = () => {

        setMenuOpen(false);

    };

    return (

        <>

            <header>
                <nav>
                    <input className='nav-check-button' type="checkbox" name="checked" id="checked" checked={isMenuOpen} onChange={handleMenuToggle} />
                    <label className='nav-check' htmlFor="checked">
                        <span className='burguer-line'></span>
                    </label>
                    <ul className='menu-responsive'>
                        <li>
                            <NavLink to='/menu' className='list-item' onClick={closeMenu}>
                                MENU
                            </NavLink>
                        </li>
                        <li>
                            <NavLink to='/about-us' className='list-item' onClick={closeMenu}>
                                NOSOTROS
                            </NavLink>
                        </li>
                        <li>
                            <NavLink to='/contact' className='list-item' onClick={closeMenu}>
                                CONTACTO
                            </NavLink>
                        </li>
                        <li>
                            <NavLink to='/login-register' className='list-item' onClick={closeMenu}>
                                INGRESAR
                            </NavLink>
                        </li>
                        <div>
                            <li>
                                <NavLink to='/admin' onClick={closeMenu}>
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
                    <NavLink to='/' className='list-image-item' onClick={closeMenu}>
                        <img src={Logo} alt="" />
                    </NavLink>
                </nav>
            </header>

        </>

    );

}