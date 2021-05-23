const puppeteer = require('puppeteer');
const csvParse = require("csv-parse/lib/sync");
const fs = require("fs");

const wait = time => new Promise(resolve => setTimeout(resolve, time))

const args = process.argv.slice(2)

const config = {
    username: args[1],
    password: args[2],
    'Target': {
        homePage: 'https://www.target.com',
        enableDebugScreenshots: false,
        enableNetworkLogging: false,
        async login(autoBuy) {
            console.log("Attempting login...")
            await Promise.all([
                autoBuy.currentPage.waitForSelector('#accountNav-signIn'),
                autoBuy.currentPage.click('#account'),
            ])
            await wait(100)
            console.log("Clicking sign in link")
            await Promise.all([
                autoBuy.currentPage.click('#accountNav-signIn'),
                autoBuy.currentPage.waitForNavigation(),
            ])

            await autoBuy.debugScreenshotCurrentPage("loginPage.png")

            console.log("Entering credentials...")
            await autoBuy.currentPage.focus('#username')
            await autoBuy.currentPage.keyboard.type(config.username)

            await autoBuy.currentPage.focus('#password')
            await autoBuy.currentPage.keyboard.type(config.password)

            await autoBuy.debugScreenshotCurrentPage("loginPageWithCredentials.png")

            await autoBuy.currentPage.focus('#login')

            console.log("Clicking login button")

            await autoBuy.debugScreenshotCurrentPage('postLoginPage.png')
            await Promise.all([
                autoBuy.currentPage.click('#login'),
                autoBuy.currentPage.waitForNavigation({waitUntil: "networkidle2"})
            ])
        },
        async addToCart(autoBuy, productDetails) {
            for(let i = 0; i < productDetails.quantityPerAttempt; i++) {
                console.log(`Adding product (${productDetails.url})`)
                await Promise.all([
                    autoBuy.currentPage.goto(productDetails.url),
                    autoBuy.currentPage.waitForSelector('[data-test="shipItButton"]'),
                ])
                await autoBuy.currentPage.click('[data-test="shipItButton"]')
            }
        },
        async getProductUrl(productDetails) {
          return Promise.resolve(productDetails.url)
        },
        async getCartUrl() {
            return Promise.resolve("https://www.target.com/co-cart")
        },
        async checkout(autoBuy) {
            await autoBuy.currentPage.goto(await config[autoBuy.targetSite].getCartUrl())
            await wait(7500)
            await autoBuy.debugScreenshotCurrentPage("cart.png")

            console.log("Starting checkout...")

            //check for cart threshold
            try {
                await autoBuy.currentPage.waitForSelector('[data-test="cart-shipping-threshold-error"]', { timeout: 10000 })
                console.log("Cart threshold not met, cannot checkout")
                await autoBuy.screenshotCurrentPage("cartThresholdError.png")
                return
            } catch (err) {
                // do nothing since cart is ready
            }

            await Promise.all([
                autoBuy.currentPage.click('[data-test="checkout-button"]'),
                autoBuy.currentPage.waitForSelector('[data-test="placeOrderButton"]'),
            ])

            await autoBuy.screenshotCurrentPage("confirmOrder.png")
        },
    }
}

class AutoBuy {
    async init(targetSite = 'Target') {
        if (this.initCalled) return

        this.targetSite = targetSite
        console.log(`Starting browser for target => ${this.targetSite} (${config[this.targetSite].homePage})`)
        this.browser = await puppeteer.launch({ ignoreHTTPSErrors: true })
        this.currentPage = await this.browser.newPage()
        await this.currentPage.setViewport({ width: 1366, height: 768});

        // prevents headless browser restrictions
        await this.currentPage.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.212 Safari/537.36")
        if (config[this.targetSite].enableNetworkLogging) {
            await this.currentPage.setRequestInterception(true)

            this.currentPage.on('request', (request) => {
                /*if (request.method() === "POST") {
                    console.log('>>', request.method(), request.url())
                }*/
                request.continue()
            })
            this.currentPage.on('response', (response) => {
                if (response.status() === 401) {
                    response.text().then(res => {
                        console.log(
                            '<<',
                            response.status(),
                            response.url() + "\n",
                            response.request().postData(),
                            res)
                    })
                }
            })
        }

        this.initCalled = true
    }

    async close() {
        await this.browser.close();
    }

    async loadHomePage() {
        if (!this.initCalled) return

        await this.currentPage.goto(config[this.targetSite].homePage);
    }

    async screenshotCurrentPage(fileName) {
        if (!this.initCalled) return

        console.log(`Saving screenshot ${fileName}`)
        await this.currentPage.screenshot({ path: "pics/" + fileName });
    }

    async debugScreenshotCurrentPage(fileName) {
        if (!this.initCalled) return

        if(config[this.targetSite].enableDebugScreenshots){
            console.log(`Debug screenshot ${fileName}`)
            await this.currentPage.screenshot({ path: "pics/debug/" + fileName });
        }
    }
}

(async () => {
    const autoBuy = new AutoBuy()
    await autoBuy.init()

    await autoBuy.loadHomePage()
    await autoBuy.debugScreenshotCurrentPage('homePage.png')
    await config[autoBuy.targetSite].login(autoBuy)

    const productsCsv = fs.readFileSync(args[0])
    const products = csvParse(productsCsv, {
        columns: true
    })

    for (const product of products) {
        console.log(`Adding ${product.quantityPerAttempt} items to cart`)
        await config[autoBuy.targetSite].addToCart(autoBuy, product)

        await config[autoBuy.targetSite].checkout(autoBuy)
    }

    await autoBuy.close()
})();
