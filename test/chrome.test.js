let webdriver = require('selenium-webdriver');
let Options = require('selenium-webdriver/chrome').Options;
let Filestorage = require('../src/index');
let fs = require('fs');
let path = require('path');
let constants = require('./utils/constants');
let helper = require('../src/common/helper');
let server = require('./utils/testServer');
let Metamask = require('./utils/MetamaskStub');
require('dotenv').config();

// eslint-disable-next-line
let chrome = require('chromedriver');

const chai = require('chai');
const assert = chai.assert;
chai.should();
chai.use(require('chai-as-promised'));

const encodeExt = file => {
    const stream = fs.readFileSync(path.resolve(file));
    return Buffer.from(stream).toString('base64');
};

describe('Chrome integration', async function () {
    let htmlPage;
    let driver;
    let downloadDir;
    let endpoint = process.env.SKALE_ENDPOINT;
    let address = process.env.ADDRESS;
    let chromeCapabilities;

    before(async function () {
        server.run();
        downloadDir = path.join(__dirname, 'testFiles');
        htmlPage = constants.TEST_SERVER_ADDRESS;
        if (!fs.existsSync(downloadDir)) {
            fs.mkdirSync(downloadDir);
        }
        chromeCapabilities = webdriver.Capabilities.chrome();
        let chromeOptions = {
            'args': ['--test-type', '--start-maximized', '--no-sandbox']
        };
        chromeCapabilities.set('chromeOptions', chromeOptions);
    });

    describe('downloadToFile', async function () {
        let fileName = 'testFile';
        let data = Buffer.from(fileName);
        let storagePath;
        let filestorage;
        let pathToFile;
        let driver;

        before(async function () {
            driver = new webdriver.Builder()
                .withCapabilities(chromeCapabilities)
                .build();
            await driver.setDownloadPath(downloadDir);
            pathToFile = path.join(downloadDir, fileName);
            filestorage = new Filestorage(endpoint);
            storagePath = await filestorage.uploadFile(address, fileName, data, process.env.PRIVATEKEY);
            driver.get(htmlPage);
        });

        it('should download file from fs to local', async function () {
            await driver.findElement(webdriver.By.id('SCHAIN_ENDPOINT')).sendKeys(endpoint);
            await driver.findElement(webdriver.By.id('storagePath')).sendKeys(storagePath);
            await driver.findElement(webdriver.By.id('downloadFile')).click();
            await driver.wait(webdriver.until.titleIs('Downloaded'), 100000);
            await driver.sleep(4000);
            assert.isTrue(fs.existsSync(pathToFile), 'File is not downloaded');
            assert.isTrue(Buffer.compare(fs.readFileSync(pathToFile), data) === 0, 'File content is differ');
        });

        after(async function () {
            driver.quit();
            await filestorage.deleteFile(address, fileName, process.env.PRIVATEKEY);
            fs.unlinkSync(pathToFile);
        });
    });

    describe('metamask', async function () {
        let fileName;
        let directoryName;
        let driver;

        async function confirmTransaction(driver) {
            let currentWindow = await driver.getWindowHandle();
            let windows = await driver.getAllWindowHandles();
            for (let i = 0; i < windows.length; ++i){
                await driver.switchTo().window(windows[i]);
                if (await driver.getTitle() === "MetaMask Notification") {
                    break;
                } else {
                    driver.switchTo().window(currentWindow);
                }
            }
            await driver.wait(webdriver.until.elementLocated(webdriver.By.xpath("//button[contains(text(), 'Confirm')]")), 10000);
            await driver.findElement(webdriver.By.xpath("//button[contains(text(), 'Confirm')]")).click();
            await driver.switchTo().window(currentWindow);
        }

        before(async function () {
            driver = new webdriver.Builder()
                .withCapabilities(chromeCapabilities)
                .setChromeOptions(new Options()
                    .addExtensions(encodeExt(path.join(__dirname, "metamask.crx"))))
                .build();
            let id = constants.METAMASK_ID;
            let metamask = new Metamask(id);
            await metamask.initialize(driver, process.env.METAMASK_PASSWORD, process.env.SEED_PHRASE);
            await metamask.addEndpoint(driver, process.env.SKALE_ENDPOINT);
            await metamask.addAccount(driver, process.env.PRIVATEKEY);
            await driver.sleep(1000);
        });

        it('should delete with metamask', async function () {
            fileName = 'testFile';
            let data = Buffer.from(fileName);
            let filestorage = new Filestorage(endpoint);
            await filestorage.uploadFile(address, fileName, data, process.env.PRIVATEKEY);
            driver.get(htmlPage);
            await driver.findElement(webdriver.By.id('account')).sendKeys(process.env.ADDRESS);
            await driver.findElement(webdriver.By.id('storagePath')).sendKeys(fileName);
            await driver.findElement(webdriver.By.id('deleteFile')).click();
            await driver.sleep(10000);
            confirmTransaction(driver);
            await driver.wait(webdriver.until.titleIs('Deleted'), 100000);
            let fileList = await filestorage.listDirectory(helper.rmBytesSymbol(process.env.ADDRESS));
            let isFind = fileList.find(obj => {
                return obj.name === fileName;
            });
            assert.isUndefined(isFind);
        });

        it('should upload with metamask', async function () {
            fileName = 'testFile';
            driver.get(htmlPage);
            let filestorage = new Filestorage(endpoint);
            await driver.findElement(webdriver.By.id('account')).sendKeys(process.env.ADDRESS);
            await driver.findElement(webdriver.By.id('storagePath')).sendKeys(fileName);
            await driver.findElement(webdriver.By.id('uploadFile')).click();
            await driver.sleep(10000);
            await confirmTransaction(driver);
            await driver.sleep(10000);
            await confirmTransaction(driver);
            await driver.sleep(10000);
            await confirmTransaction(driver);
            await driver.wait(webdriver.until.titleIs('Uploaded'), 100000);
            let fileList = await filestorage.listDirectory(helper.rmBytesSymbol(process.env.ADDRESS));
            let isFind = fileList.find(obj => {
                return obj.name === fileName;
            });
            assert.isObject(isFind);
            assert.isTrue(isFind.uploadingProgress === 100);
        });

        it('should create directory with metamask', async function () {
            directoryName = 'testDirectory';
            let filestorage = new Filestorage(endpoint);
            driver.get(htmlPage);
            await driver.findElement(webdriver.By.id('account')).sendKeys(process.env.ADDRESS);
            await driver.findElement(webdriver.By.id('storagePath')).sendKeys(directoryName);
            await driver.findElement(webdriver.By.id('createDirectory')).click();
            await driver.sleep(10000);
            confirmTransaction(driver);
            await driver.wait(webdriver.until.titleIs('Directory created'), 100000);
            let fileList = await filestorage.listDirectory(helper.rmBytesSymbol(process.env.ADDRESS));
            let isFind = fileList.find(obj => {
                return obj.name === directoryName;
            });
            assert.isObject(isFind);
            assert.isFalse(isFind.isFile);
        });

        it('should delete directory with metamask', async function () {
            directoryName = 'testDirectory';
            let filestorage = new Filestorage(endpoint);
            await filestorage.createDirectory(address, directoryName, process.env.PRIVATEKEY);
            driver.get(htmlPage);
            await driver.findElement(webdriver.By.id('account')).sendKeys(process.env.ADDRESS);
            await driver.findElement(webdriver.By.id('storagePath')).sendKeys(directoryName);
            await driver.findElement(webdriver.By.id('deleteDirectory')).click();
            await driver.sleep(10000);
            confirmTransaction(driver);
            await driver.wait(webdriver.until.titleIs('Directory deleted'), 100000);
            let fileList = await filestorage.listDirectory(helper.rmBytesSymbol(process.env.ADDRESS));
            let isFind = fileList.find(obj => {
                return obj.name === directoryName;
            });
            assert.isUndefined(isFind);
        });

        afterEach(async function(){
            let filestorage = new Filestorage(endpoint);
            let fileList = await filestorage.listDirectory(helper.rmBytesSymbol(process.env.ADDRESS));
            let isFind = fileList.find(obj => {
                return obj.name === fileName;
            });
            if (isFind){
                await filestorage.deleteFile(address, fileName, process.env.PRIVATEKEY);
            }
            isFind = fileList.find(obj => {
                return obj.name === directoryName;
            });
            if (isFind){
                await filestorage.deleteDirectory(address, directoryName, process.env.PRIVATEKEY);
            }
        });

        after(async function(){
            await driver.quit();
        })
    });

    after(async function () {
        fs.rmdirSync(downloadDir);
        server.stop();
    });
});
