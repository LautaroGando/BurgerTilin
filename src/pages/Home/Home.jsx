import HomeBanner from "../../components/HomeBanner/HomeBanner"
import HomeInfo from "../../components/HomeInfo/HomeInfo"
import HomeWpp from "../../components/HomeWpp/HomeWpp"

export default function Home() {

    return (

        <>

            <HomeBanner />

            <HomeInfo sendFree="10.000"/>

            <HomeWpp />

        </>

    )

}