import { Route, Routes } from 'react-router-dom'
import './App.css'
import Header from './Layouts/Header/Header'
import Home from './pages/Home/Home'
import Menu from './pages/Menu/Menu'
import Contact from './pages/Contact/Contact'
import AboutUs from './pages/AboutUs/AboutUs'
import LoginRegister from './pages/LoginRegister/LoginRegister'
import Admin from './pages/Admin/Admin'

function App() {

    return (

        <>

            <Header />

            <main>
                <Routes>
                    <Route path='/home' element={<Home />} />
                    <Route path='/menu' element={<Menu />} />
                    <Route path='/about-us' element={<AboutUs />} />
                    <Route path='/contact' element={<Contact />} />
                    <Route path='/login-register' element={<LoginRegister />} />
                    <Route path='/admin' element={<Admin />} />
                </Routes>
            </main>

        </>

    )

}

export default App
