// GitHub Actions 최적화된 예약 스크립트
require('dotenv').config();

const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');

class GitHubOptimizedPilatesBooking {
    constructor() {
        this.username = process.env.PILATES_USERNAME;
        this.password = process.env.PILATES_PASSWORD;
        this.baseUrl = 'https://ad2.mbgym.kr';
        this.maxRetries = 2; // GitHub Actions용 단축
        this.retryDelay = 500; // 빠른 재시도
        
        // GitHub Actions 환경 감지
        this.isGitHubActions = process.env.GITHUB_ACTIONS === 'true';
        this.executionMode = process.env.EXECUTION_MODE || 'unknown';
        this.timingInfo = process.env.TIMING_INFO || '';
        
        // 테스트 모드
        this.testMode = process.env.TEST_MODE === 'true';
        
        // 상태 플래그
        this.bookingSuccess = false;
        this.isWaitingReservation = false;
        this.hasConflictError = false;
        this.hasTimeoutError = false;
        
        // GitHub Actions 최적화 설정
        this.githubOptimizations = {
            fastTimeout: 15000,      // 빠른 타임아웃
            skipScreenshots: false,   // 스크린샷 유지 (디버그용)
            quickRetry: true,        // 빠른 재시도
            earlyExit: true          // 조기 종료
        };
    }

    // 한국 시간 계산 (최적화)
    getKSTDate() {
        const now = new Date();
        const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000);
        const kstOffset = 9 * 60 * 60 * 1000;
        return new Date(utcTime + kstOffset);
    }

    // 7일 후 날짜 계산
    getTargetDate() {
        const kstNow = this.getKSTDate();
        const targetDate = new Date(kstNow);
        targetDate.setDate(targetDate.getDate() + 7);
        
        return {
            year: targetDate.getFullYear(),
            month: targetDate.getMonth() + 1,
            day: targetDate.getDate(),
            dayOfWeek: targetDate.getDay(),
            dateObject: targetDate,
            kstString: targetDate.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
        };
    }

    // 주말 체크
    isWeekend(date) {
        const dayOfWeek = date.getDay();
        return dayOfWeek === 0 || dayOfWeek === 6;
    }

    // 요일 이름
    getDayName(date) {
        const days = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
        return days[date.getDay()];
    }

    // GitHub Actions 전용 초기화
    async init() {
        try {
            await fs.mkdir('screenshots', { recursive: true });
            await fs.mkdir('logs', { recursive: true });
        } catch (err) {
            // 무시
        }
        
        const kstNow = this.getKSTDate();
        const targetInfo = this.getTargetDate();
        
        await this.log(`=== GitHub Actions 최적화 예약 시작 ===`);
        await this.log(`🕐 현재 KST: ${kstNow.toLocaleString('ko-KR')}`);
        await this.log(`🎯 실행 모드: ${this.executionMode}`);
        await this.log(`⏰ 타이밍 정보: ${this.timingInfo}`);
        await this.log(`📅 예약 대상: ${targetInfo.year}년 ${targetInfo.month}월 ${targetInfo.day}일`);
        
        // 주말 체크
        const targetDate = targetInfo.dateObject;
        const dayName = this.getDayName(targetDate);
        
        if (this.isWeekend(targetDate)) {
            await this.log(`🚫 주말(${dayName}) - 예약 스킵`);
            
            const resultInfo = {
                timestamp: this.getKSTDate().toISOString(),
                date: `${targetInfo.year}-${targetInfo.month}-${targetInfo.day}`,
                dayOfWeek: dayName,
                status: 'WEEKEND_SKIP',
                message: `주말(${dayName}) 예약 건너뛰기`,
                executionMode: this.executionMode,
                timingInfo: this.timingInfo,
                githubActions: true
            };
            
            await this.saveResult(resultInfo);
            process.exit(0);
        }
        
        await this.log(`✅ 평일(${dayName}) 확인 - 예약 진행`);
        
        if (this.testMode) {
            await this.log('🧪 테스트 모드 실행');
        }
    }

    // 로그 함수 (GitHub Actions 최적화)
    async log(message) {
        const kstNow = this.getKSTDate();
        const timestamp = kstNow.toISOString().replace('Z', '+09:00');
        const logMessage = `[${timestamp}] ${message}`;
        
        console.log(logMessage);
        
        // GitHub Actions에서는 로그 파일 쓰기 최소화
        if (!this.isGitHubActions) {
            try {
                const logFile = this.testMode ? 'logs/test.log' : 'logs/booking.log';
                await fs.appendFile(logFile, logMessage + '\n');
            } catch (error) {
                // 무시
            }
        }
    }

    // 스크린샷 (조건부)
    async takeScreenshot(page, name) {
        if (this.githubOptimizations.skipScreenshots && this.isGitHubActions) {
            return null;
        }
        
        try {
            const timestamp = Date.now();
            const prefix = this.testMode ? 'test-' : '';
            const filename = `screenshots/${prefix}${name}-${timestamp}.png`;
            
            await page.screenshot({ 
                path: filename, 
                fullPage: false, // GitHub Actions에서는 일부만
                quality: 50      // 압축률 높임
            });
            
            await this.log(`📸 스크린샷: ${filename}`);
            return filename;
        } catch (error) {
            await this.log(`⚠️ 스크린샷 실패: ${error.message}`);
            return null;
        }
    }

    // GitHub Actions 최적화 로그인
    async login(page) {
        await this.log('🔐 로그인 시도...');
        
        try {
            // 빠른 페이지 설정
            await page.setRequestInterception(true);
            page.on('request', (request) => {
                // 불필요한 리소스 차단
                if (['image', 'stylesheet', 'font'].includes(request.resourceType())) {
                    request.abort();
                } else {
                    request.continue();
                }
            });
            
            // 로그인 페이지 이동
            await page.goto(`${this.baseUrl}/yeapp/yeapp.php?tm=102`, {
                waitUntil: 'domcontentloaded', // networkidle2 대신 빠른 로드
                timeout: this.githubOptimizations.fastTimeout
            });
            
            await this.takeScreenshot(page, '01-login');
            
            // 이미 로그인 확인
            const logoutLink = await page.$('a[href*="yeout.php"]');
            if (logoutLink) {
                await this.log('✅ 이미 로그인됨');
                return true;
            }
            
            // 로그인 폼 입력 (최적화)
            await page.waitForSelector('input#user_id, input[name="name"]', { 
                timeout: this.githubOptimizations.fastTimeout 
            });
            
            const useridSelector = await page.$('input#user_id') ? 'input#user_id' : 'input[name="name"]';
            const passwdSelector = await page.$('input#passwd') ? 'input#passwd' : 'input[name="passwd"]';
            
            // 빠른 입력
            await page.evaluate((selector, value) => {
                document.querySelector(selector).value = value;
            }, useridSelector, this.username);
            
            await page.evaluate((selector, value) => {
                document.querySelector(selector).value = value;
            }, passwdSelector, this.password);
            
            await this.log(`📝 입력 완료: ${this.username}`);
            
            // 로그인 버튼 클릭
            const submitButton = await page.$('input[type="submit"]');
            if (submitButton) {
                await Promise.all([
                    page.waitForNavigation({ 
                        waitUntil: 'domcontentloaded',
                        timeout: this.githubOptimizations.fastTimeout 
                    }).catch(() => {}),
                    submitButton.click()
                ]);
            }
            
            await this.takeScreenshot(page, '02-after-login');
            await this.log('✅ 로그인 완료');
            
            return true;
            
        } catch (error) {
            await this.log(`❌ 로그인 실패: ${error.message}`);
            throw error;
        }
    }

    // 예약 페이지 이동 (최적화)
    async navigateToBookingPage(page) {
        await this.log('📅 예약 페이지 이동...');
        
        const targetInfo = this.getTargetDate();
        const { year, month, day } = targetInfo;
        
        await this.log(`📆 목표 날짜: ${year}년 ${month}월 ${day}일`);
        
        // 현재 페이지가 예약 페이지인지 확인
        const currentUrl = page.url();
        if (currentUrl.includes('res_postform.php')) {
            await this.log('📍 이미 예약 페이지에 있음');
            
            // 날짜 클릭 (최적화)
            const dateClicked = await page.evaluate((targetDay) => {
                const cells = document.querySelectorAll('td');
                
                for (let cell of cells) {
                    const text = cell.textContent.trim();
                    const regex = new RegExp(`^${targetDay}(\\s|$|[^0-9])`);
                    
                    if (regex.test(text) && !text.includes('X')) {
                        const link = cell.querySelector('a');
                        if (link) {
                            link.click();
                            return true;
                        } else if (!text.includes('X')) {
                            cell.click();
                            return true;
                        }
                    }
                }
                return false;
            }, day);
            
            if (dateClicked) {
                await this.log(`✅ ${day}일 클릭 완료`);
                await page.waitForTimeout(2000); // 단축된 대기
            } else {
                await this.log(`⚠️ ${day}일 클릭 실패`);
            }
        }
        
        await this.takeScreenshot(page, '03-booking-page');
        return { year, month, day };
    }

    // 09:30 수업 찾기 및 예약 (GitHub Actions 최적화)
    async find0930ClassAndBook(page) {
        await this.log('🔍 09:30 수업 검색...');
        
        this.hasConflictError = false;
        this.hasTimeoutError = false;
        
        try {
            await page.waitForSelector('table', { 
                timeout: this.githubOptimizations.fastTimeout 
            }).catch(() => {
                this.log('⚠️ 테이블 로드 타임아웃');
            });
            
            await this.takeScreenshot(page, '04-time-table');
            
            // 다이얼로그 핸들러 (최적화)
            let dialogHandled = false;
            const dialogHandler = async (dialog) => {
                const message = dialog.message();
                await this.log(`📢 알림: ${message}`);
                
                if (!dialogHandled) {
                    dialogHandled = true;
                    
                    if (message.includes('정원이 초과') && message.includes('대기예약')) {
                        this.isWaitingReservation = true;
                        this.bookingSuccess = true;
                        await dialog.accept();
                        await this.log('✅ 대기예약 확인');
                        return;
                    }
                    
                    if (message.includes('요일별 예약횟수가 완료')) {
                        this.bookingSuccess = true;
                        await dialog.accept();
                        await this.log('🎉 예약횟수 완료');
                        return;
                    }
                    
                    if (message.includes('동시신청') || message.includes('잠시 후')) {
                        this.hasConflictError = true;
                        await dialog.accept();
                        await this.log('⚠️ 동시신청 충돌');
                        return;
                    }
                    
                    if (message.includes('예약') && 
                        (message.includes('완료') || message.includes('성공'))) {
                        this.bookingSuccess = true;
                        await dialog.accept();
                        await this.log('🎉 예약 성공!');
                        return;
                    }
                }
                
                await dialog.accept();
            };
            
            page.on('dialog', dialogHandler);
            
            // 09:30 수업 검색 및 예약 (최적화된 로직)
            const result = await page.evaluate(() => {
                console.log('=== 09:30 수업 검색 ===');
                
                const allRows = document.querySelectorAll('tr');
                
                // 이미 예약된 09:30 수업 확인
                for (let i = 0; i < allRows.length; i++) {
                    const row = allRows[i];
                    const rowText = row.textContent || '';
                    
                    if ((rowText.includes('09:30') || rowText.includes('9:30')) && 
                        !rowText.includes('오후') && !rowText.includes('PM')) {
                        
                        const cells = row.querySelectorAll('td');
                        if (cells.length >= 3) {
                            for (let j = 0; j < cells.length; j++) {
                                const cellText = cells[j].textContent.trim();
                                
                                if (cellText === '오전 09:30' || cellText === '오전 9:30' ||
                                    cellText.includes('09:30') || cellText.includes('9:30')) {
                                    
                                    let actionCell = cells[cells.length - 1];
                                    if (j < cells.length - 1) {
                                        const nextCell = cells[j + 1];
                                        if (nextCell.textContent.includes('예약') || 
                                            nextCell.textContent.includes('대기') ||
                                            nextCell.textContent.includes('완료') ||
                                            nextCell.textContent.includes('불가')) {
                                            actionCell = nextCell;
                                        }
                                    }
                                    
                                    const actionText = actionCell.textContent.trim();
                                    console.log(`09:30 상태: ${actionText}`);
                                    
                                    // 이미 예약된 경우
                                    if (actionText.includes('예약완료') || actionText.includes('대기완료') || 
                                        actionText.includes('삭제') || actionText.includes('취소')) {
                                        return {
                                            found: true,
                                            booked: false,
                                            alreadyBooked: true,
                                            message: `09:30 수업 이미 ${actionText.includes('대기완료') ? '대기예약' : '예약'} 완료`
                                        };
                                    }
                                    
                                    // 예약 가능한 경우
                                    const link = actionCell.querySelector('a');
                                    
                                    if (actionText.includes('예약하기')) {
                                        if (link) {
                                            console.log('🎯 09:30 예약하기 클릭');
                                            link.click();
                                            return {
                                                found: true,
                                                booked: true,
                                                message: '09:30 수업 예약 클릭',
                                                needSubmit: true
                                            };
                                        }
                                    } else if (actionText.includes('대기예약')) {
                                        if (link) {
                                            console.log('⏳ 09:30 대기예약 클릭');
                                            link.click();
                                            return {
                                                found: true,
                                                booked: true,
                                                message: '09:30 수업 대기예약',
                                                isWaitingOnly: true,
                                                needSubmit: false
                                            };
                                        }
                                    } else if (actionText.includes('예약불가')) {
                                        return {
                                            found: true,
                                            booked: false,
                                            unavailable: true,
                                            message: '09:30 수업 예약불가 (정원 초과)'
                                        };
                                    }
                                    
                                    break;
                                }
                            }
                        }
                    }
                }
                
                return {
                    found: false,
                    booked: false,
                    message: '09:30 수업을 찾을 수 없음'
                };
            });
            
            await this.log(`🔍 검색 결과: ${result.message}`);
            
            // 결과 처리
            if (result.unavailable) {
                await this.log('⚠️ 예약불가 상태');
                page.off('dialog', dialogHandler);
                return result;
            }
            
            if (result.alreadyBooked) {
                await this.log('✅ 이미 예약 완료 - 중복 방지');
                this.bookingSuccess = true;
                if (result.message.includes('대기')) {
                    this.isWaitingReservation = true;
                }
                page.off('dialog', dialogHandler);
                return result;
            }
            
            // 예약 후 처리 (최적화)
            if (result.booked) {
                await this.log('⏳ 예약 처리 중...');
                
                if (result.isWaitingOnly) {
                    await page.waitForTimeout(2000); // 단축된 대기
                } else if (result.needSubmit && !this.testMode) {
                    await this.log('📝 Submit 처리...');
                    await page.waitForTimeout(500);
                    
                    const submitSuccess = await page.evaluate(() => {
                        const submitElements = [
                            ...document.querySelectorAll('input[type="submit"]'),
                            ...document.querySelectorAll('button[type="submit"]'),
                            ...document.querySelectorAll('input[type="image"]'),
                            ...document.querySelectorAll('button')
                        ];
                        
                        for (let elem of submitElements) {
                            const text = (elem.value || elem.textContent || '').trim();
                            if (text.includes('예약') || text.includes('확인') || 
                                text.includes('등록') || text === 'Submit') {
                                elem.click();
                                return true;
                            }
                        }
                        
                        const forms = document.querySelectorAll('form');
                        if (forms.length > 0) {
                            forms[0].submit();
                            return true;
                        }
                        
                        return false;
                    });
                    
                    if (submitSuccess) {
                        await this.log('✅ Submit 완료');
                        await page.waitForTimeout(1500); // 단축된 대기
                        
                        if (this.hasConflictError) {
                            page.off('dialog', dialogHandler);
                            throw new Error('동시신청 충돌');
                        }
                        
                        await this.takeScreenshot(page, '06-submit-result');
                    }
                }
                
                await this.takeScreenshot(page, '07-booking-result');
            }
            
            page.off('dialog', dialogHandler);
            return result;
            
        } catch (error) {
            await this.log(`❌ 예약 과정 오류: ${error.message}`);
            await this.takeScreenshot(page, 'error-booking');
            throw error;
        }
    }

    // 결과 저장 (최적화)
    async saveResult(resultInfo) {
        const resultFile = this.testMode ? 'test-result.json' : 'booking-result.json';
        
        try {
            await fs.writeFile(resultFile, JSON.stringify(resultInfo, null, 2));
            await this.log(`💾 결과 저장: ${resultFile}`);
        } catch (error) {
            await this.log(`⚠️ 결과 저장 실패: ${error.message}`);
        }
    }

    // GitHub Actions 최적화 메인 실행
    async run() {
        await this.init();
        
        let retryCount = 0;
        let success = false;
        
        while (retryCount < this.maxRetries && !success) {
            const browser = await puppeteer.launch({
                headless: 'new',
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--disable-web-security',
                    '--disable-features=VizDisplayCompositor',
                    '--disable-extensions',
                    '--disable-background-timer-throttling',
                    '--disable-renderer-backgrounding',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-ipc-flooding-protection',
                    '--memory-pressure-off',
                    '--max_old_space_size=4096',
                    '--window-size=1280,720' // 작은 창 크기
                ]
            });
            
            try {
                const page = await browser.newPage();
                
                // GitHub Actions 최적화 설정
                page.setDefaultTimeout(this.githubOptimizations.fastTimeout);
                await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36');
                await page.setViewport({ width: 1280, height: 720 });
                
                // 콘솔 로그 캡처 (최소화)
                if (!this.isGitHubActions) {
                    page.on('console', msg => {
                        if (msg.type() === 'log') {
                            this.log(`[브라우저]: ${msg.text()}`);
                        }
                    });
                }
                
                // 1. 로그인
                await this.login(page);
                
                // 2. 예약 페이지 이동
                const dateInfo = await this.navigateToBookingPage(page);
                
                // 3. 09:30 수업 예약
                const result = await this.find0930ClassAndBook(page);
                
                // 4. 결과 처리
                if (result.booked || result.alreadyBooked || result.unavailable) {
                    await this.log('✅ 예약 프로세스 완료');
                    success = true;
                    
                    // 결과 저장
                    const resultInfo = {
                        timestamp: this.getKSTDate().toISOString(),
                        date: `${dateInfo.year}-${dateInfo.month}-${dateInfo.day}`,
                        class: '09:30',
                        status: this.testMode ? 'TEST' : 
                               result.unavailable ? 'UNAVAILABLE' :
                               result.alreadyBooked ? (this.isWaitingReservation ? 'ALREADY_WAITING' : 'ALREADY_BOOKED') :
                               (this.isWaitingReservation ? 'WAITING' : 'SUCCESS'),
                        message: result.message,
                        executionMode: this.executionMode,
                        timingInfo: this.timingInfo,
                        retryCount: retryCount,
                        githubActions: this.isGitHubActions,
                        bookingSuccess: result.unavailable ? false : this.bookingSuccess,
                        isWaitingReservation: this.isWaitingReservation
                    };
                    
                    await this.saveResult(resultInfo);
                    
                    // 상태별 로그
                    if (result.unavailable) {
                        await this.log('⚠️ 예약불가 - GitHub Actions 지연 영향');
                    } else {
                        await this.log('🎉 예약 프로세스 성공!');
                        if (this.isWaitingReservation) {
                            await this.log('⚠️ 대기예약 등록됨');
                        }
                        if (result.alreadyBooked) {
                            await this.log('📋 중복 예약 방지 작동');
                        }
                    }
                    
                } else {
                    throw new Error(result.found ? '예약 처리 실패' : '09:30 수업 없음');
                }
                
            } catch (error) {
                retryCount++;
                await this.log(`❌ 시도 ${retryCount}/${this.maxRetries} 실패: ${error.message}`);
                
                if (retryCount < this.maxRetries && this.githubOptimizations.quickRetry) {
                    await this.log(`🔄 ${this.retryDelay}ms 후 재시도`);
                    await new Promise(resolve => setTimeout(resolve, this.retryDelay));
                }
                
            } finally {
                await browser.close();
            }
        }
        
        if (!success) {
            await this.log('❌ 최종 실패');
            
            const targetInfo = this.getTargetDate();
            const resultInfo = {
                timestamp: this.getKSTDate().toISOString(),
                date: `${targetInfo.year}-${targetInfo.month}-${targetInfo.day}`,
                class: '09:30',
                status: 'FAILED',
                message: 'GitHub Actions 실행 실패',
                executionMode: this.executionMode,
                timingInfo: this.timingInfo,
                githubActions: this.isGitHubActions,
                bookingSuccess: false
            };
            
            await this.saveResult(resultInfo);
            process.exit(1);
        }
    }
}

// 환경변수 확인
if (!process.env.PILATES_USERNAME || !process.env.PILATES_PASSWORD) {
    console.error('❌ 환경변수 필요: PILATES_USERNAME, PILATES_PASSWORD');
    process.exit(1);
}

// 실행
const booking = new GitHubOptimizedPilatesBooking();
booking.run().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
