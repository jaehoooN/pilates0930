// 로컬 환경변수 파일 로드
if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');

class PilatesBooking {
    constructor() {
        this.username = process.env.PILATES_USERNAME; // 회원이름
        this.password = process.env.PILATES_PASSWORD; // 회원번호
        this.baseUrl = 'https://ad2.mbgym.kr';
        this.maxRetries = 3;
        this.retryDelay = 1000;
        
        // 테스트 모드 설정
        this.testMode = process.env.TEST_MODE === 'true';
        
        // 예약 성공 플래그
        this.bookingSuccess = false;
    }

    // 한국 시간(KST) 기준으로 날짜 계산 (정확한 계산)
    getKSTDate() {
        const now = new Date();
        // UTC 시간에서 KST로 정확한 변환 (+9시간)
        const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000);
        const kstOffset = 9 * 60 * 60 * 1000; // 9시간을 밀리초로
        const kstTime = new Date(utcTime + kstOffset);
        return kstTime;
    }

    // 7일 후 한국 시간 기준 날짜 계산
    getTargetDate() {
        const kstNow = this.getKSTDate();
        const targetDate = new Date(kstNow);
        targetDate.setDate(targetDate.getDate() + 7);
        
        return {
            year: targetDate.getFullYear(),
            month: targetDate.getMonth() + 1,
            day: targetDate.getDate(),
            dayOfWeek: targetDate.getDay(), // 0=일요일, 1=월요일, ..., 6=토요일
            dateObject: targetDate, // KST Date 객체 직접 반환
            kstString: targetDate.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
        };
    }

    // 주말 체크 함수 (수정됨: 0=일요일, 6=토요일만 주말)
    isWeekend(date) {
        const dayOfWeek = date.getDay(); // 0=일요일, 1=월요일, ..., 6=토요일
        const isWeekendDay = dayOfWeek === 0 || dayOfWeek === 6; // 일요일(0) 또는 토요일(6)
        
        console.log(`주말 체크: 요일=${dayOfWeek} (0=일, 1=월, 2=화, 3=수, 4=목, 5=금, 6=토), 주말여부=${isWeekendDay}`);
        
        return isWeekendDay;
    }

    // 요일 이름 반환
    getDayName(date) {
        const days = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
        return days[date.getDay()];
    }

    async init() {
        try {
            await fs.mkdir('screenshots', { recursive: true });
            await fs.mkdir('logs', { recursive: true });
        } catch (err) {
            console.log('디렉토리 생성 중 오류 (무시 가능):', err.message);
        }
        
        const kstNow = this.getKSTDate();
        const targetInfo = this.getTargetDate();
        
        await this.log(`=== 예약 시작: ${kstNow.toLocaleString('ko-KR')} (KST) ===`);
        await this.log(`📅 예약 대상 날짜: ${targetInfo.year}년 ${targetInfo.month}월 ${targetInfo.day}일`);
        await this.log(`🕘 현재 KST 시간: ${kstNow.toLocaleString('ko-KR')}`);
        
        // 주말 체크 - KST 기준 Date 객체 직접 사용
        const targetDate = targetInfo.dateObject; // KST 기준 Date 객체
        const dayName = this.getDayName(targetDate);
        const dayOfWeek = targetDate.getDay();
        
        await this.log(`📆 예약 대상 요일: ${dayName} (숫자: ${dayOfWeek}, KST 기준)`);
        await this.log(`🔍 주말 판정 기준: 0=일요일, 6=토요일만 주말`);
        
        if (this.isWeekend(targetDate)) {
            await this.log(`🚫 주말(${dayName})에는 예약하지 않습니다.`);
            
            // 주말 스킵 결과 저장
            const resultInfo = {
                timestamp: this.getKSTDate().toISOString(),
                date: `${targetInfo.year}-${targetInfo.month}-${targetInfo.day}`,
                dayOfWeek: dayName,
                dayOfWeekNumber: dayOfWeek,
                status: 'WEEKEND_SKIP',
                message: `주말(${dayName}) 예약 건너뛰기`,
                kstTime: this.getKSTDate().toLocaleString('ko-KR'),
                note: 'KST 기준 주말 판정 (0=일요일, 6=토요일)'
            };
            
            const resultFile = this.testMode ? 'test-result.json' : 'booking-result.json';
            await fs.writeFile(
                resultFile,
                JSON.stringify(resultInfo, null, 2)
            );
            
            await this.log('✅ 주말 스킵 완료');
            process.exit(0); // 정상 종료
        }
        
        await this.log(`✅ 평일(${dayName}) 확인 - 예약 진행`);
        
        if (this.testMode) {
            await this.log('⚠️ 테스트 모드로 실행 중 (실제 예약하지 않음)');
        }
    }

    async log(message) {
        const kstNow = this.getKSTDate();
        const timestamp = kstNow.toISOString().replace('Z', '+09:00'); // KST 표시
        const logMessage = `[${timestamp}] ${message}\n`;
        console.log(message);
        
        try {
            const logFile = this.testMode ? 'logs/test.log' : 'logs/booking.log';
            await fs.appendFile(logFile, logMessage);
        } catch (error) {
            // 로그 파일 쓰기 실패는 무시
        }
    }

    async takeScreenshot(page, name) {
        try {
            await fs.mkdir('screenshots', { recursive: true });
            
            const timestamp = Date.now();
            const prefix = this.testMode ? 'test-' : '';
            const filename = `screenshots/${prefix}${name}-${timestamp}.png`;
            await page.screenshot({ path: filename, fullPage: true });
            await this.log(`📸 스크린샷 저장: ${filename}`);
            return filename;
        } catch (error) {
            await this.log(`⚠️ 스크린샷 실패: ${error.message}`);
        }
    }

    async login(page) {
        await this.log('🔐 로그인 시도...');
        
        try {
            // 인코딩 설정
            await page.setExtraHTTPHeaders({
                'Accept-Language': 'ko-KR,ko;q=0.9',
                'Accept-Charset': 'UTF-8'
            });
            
            // 로그인 페이지로 이동
            await page.goto(`${this.baseUrl}/yeapp/yeapp.php?tm=102`, {
                waitUntil: 'networkidle2',
                timeout: 30000
            });
            
            await this.takeScreenshot(page, '01-login-page');
            
            // 이미 로그인된 상태인지 확인
            const logoutLink = await page.$('a[href*="yeout.php"]');
            if (logoutLink) {
                await this.log('✅ 이미 로그인된 상태');
                return true;
            }
            
            // 로그인 폼 입력 - ID 기반 선택자 사용
            await page.waitForSelector('input#user_id, input[name="name"]', { timeout: 10000 });
            
            // ID 기반 선택자 우선 사용
            const useridInput = await page.$('input#user_id');
            const passwdInput = await page.$('input#passwd');
            
            let useridSelector, passwdSelector;
            
            if (useridInput) {
                useridSelector = 'input#user_id';
            } else {
                useridSelector = 'input[name="name"]';
            }
            
            if (passwdInput) {
                passwdSelector = 'input#passwd';
            } else {
                passwdSelector = 'input[name="passwd"]';
            }
            
            // 입력 필드 클리어 후 입력
            await page.click(useridSelector, { clickCount: 3 });
            await page.type(useridSelector, this.username, { delay: 50 });
            
            await page.click(passwdSelector, { clickCount: 3 });
            await page.type(passwdSelector, this.password, { delay: 50 });
            
            await this.log(`📝 입력 정보: 이름=${this.username}, 번호=${this.password}`);
            
            // 로그인 버튼 클릭 - 더 안전한 방법
            const submitButton = await page.$('input[type="submit"]');
            if (submitButton) {
                await Promise.all([
                    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}),
                    submitButton.click()
                ]);
            } else {
                throw new Error('로그인 버튼을 찾을 수 없습니다');
            }
            
            await this.takeScreenshot(page, '02-after-login');
            
            // 로그인 성공 확인
            const currentUrl = page.url();
            if (currentUrl.includes('res_postform.php')) {
                await this.log('✅ 로그인 성공 - 예약 페이지 진입');
                return true;
            }
            
            await this.log('✅ 로그인 완료');
            return true;
            
        } catch (error) {
            await this.log(`❌ 로그인 실패: ${error.message}`);
            throw error;
        }
    }

    async navigateToBookingPage(page) {
        await this.log('📅 예약 페이지로 이동...');
        
        // KST 기준으로 7일 후 날짜 계산
        const targetInfo = this.getTargetDate();
        const { year, month, day } = targetInfo;
        
        await this.log(`📆 예약 날짜: ${year}년 ${month}월 ${day}일 (KST 기준)`);
        
        // 현재 페이지가 이미 예약 페이지인지 확인
        const currentUrl = page.url();
        if (currentUrl.includes('res_postform.php')) {
            await this.log('📍 이미 예약 페이지에 있음');
            
            // 해당 날짜 클릭
            const dateClicked = await page.evaluate((targetDay) => {
                const cells = document.querySelectorAll('td');
                
                for (let cell of cells) {
                    const text = cell.textContent.trim();
                    
                    // 정확한 날짜 매칭
                    if (text === String(targetDay) || 
                        (text.startsWith(String(targetDay)) && !text.includes('X'))) {
                        
                        // 클릭 가능한 요소 찾기
                        const link = cell.querySelector('a');
                        if (link) {
                            // onclick 속성 확인
                            const onclickAttr = link.getAttribute('onclick');
                            if (onclickAttr) {
                                console.log('onclick 발견:', onclickAttr);
                                // JavaScript 함수 직접 실행
                                try {
                                    // eval 대신 더 안전한 방법 사용
                                    const func = new Function(onclickAttr);
                                    func();
                                } catch(e) {
                                    link.click();
                                }
                            } else {
                                link.click();
                            }
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
                // 페이지 로드 대기
                await page.waitForTimeout(3000);
            } else {
                await this.log(`⚠️ ${day}일 예약 불가 또는 마감`);
            }
        }
        
        await this.takeScreenshot(page, '03-booking-page');
        return { year, month, day };
    }

    async find1030ClassAndBook(page) {
        await this.log('🔍 10:30 수업 찾는 중...');
        
        try {
            await page.waitForSelector('table', { timeout: 5000 }).catch(() => {
                this.log('⚠️ 테이블 로드 대기 시간 초과');
            });
            
            await this.takeScreenshot(page, '04-time-table');
            
            // 10:30 수업 검색 및 예약
            const result = await page.evaluate(() => {
                console.log('=== 10:30 수업 검색 시작 ===');
                
                // 모든 테이블 행을 검색
                const allRows = document.querySelectorAll('tr');
                console.log(`전체 행 수: ${allRows.length}`);
                
                // 10:30을 포함하는 행 찾기
                for (let i = 0; i < allRows.length; i++) {
                    const row = allRows[i];
                    const rowText = row.textContent || '';
                    
                    // 10:30이 포함되어 있는지 확인 (09:30 제외)
                    if ((rowText.includes('10:30') || rowText.includes('10시30분')) && 
                        !rowText.includes('09:30') && !rowText.includes('09시30분')) {
                        
                        const cells = row.querySelectorAll('td');
                        console.log(`10:30 포함 행 발견 (행 ${i}), 셀 수: ${cells.length}`);
                        
                        // 셀이 3개 이상인 경우만
                        if (cells.length >= 3) {
                            // 각 셀 내용 확인
                            for (let j = 0; j < cells.length; j++) {
                                const cellText = cells[j].textContent.trim();
                                console.log(`  셀 ${j}: ${cellText.substring(0, 30)}`);
                                
                                // 시간 셀 확인
                                if (cellText === '오전 10:30' || 
                                    (cellText.includes('10:30') && !cellText.includes('09:30'))) {
                                    
                                    console.log(`✅ 10:30 시간 확인! 셀 인덱스: ${j}`);
                                    
                                    // 예약 버튼 찾기 (보통 마지막 셀)
                                    let actionCell = cells[cells.length - 1];
                                    
                                    // 시간 셀 다음이 예약 셀일 수도 있음
                                    if (j < cells.length - 1) {
                                        const nextCell = cells[j + 1];
                                        if (nextCell.textContent.includes('예약') || 
                                            nextCell.textContent.includes('대기')) {
                                            actionCell = nextCell;
                                        }
                                    }
                                    
                                    const actionText = actionCell.textContent.trim();
                                    console.log(`예약 셀 내용: ${actionText}`);
                                    
                                    // 예약 링크 찾기
                                    const link = actionCell.querySelector('a');
                                    
                                    if (actionText.includes('예약하기')) {
                                        if (link) {
                                            console.log('🎯 10:30 예약하기 링크 클릭!');
                                            link.click();
                                            return {
                                                found: true,
                                                booked: true,
                                                message: '10:30 수업 예약 클릭',
                                                needSubmit: true
                                            };
                                        }
                                    } else if (actionText.includes('대기')) {
                                        if (link) {
                                            console.log('⏳ 10:30 대기예약 링크 클릭');
                                            link.click();
                                            return {
                                                found: true,
                                                booked: true,
                                                message: '10:30 수업 대기예약',
                                                isWaitingOnly: true,
                                                needSubmit: true
                                            };
                                        }
                                    } else if (actionText.includes('삭제') || actionText.includes('취소')) {
                                        return {
                                            found: true,
                                            booked: false,
                                            message: '10:30 수업은 이미 예약됨'
                                        };
                                    }
                                    
                                    break; // 10:30 찾았으므로 종료
                                }
                            }
                        }
                    }
                }
                
                // 대체 방법: 링크 기반 검색
                console.log('=== 대체 방법: 링크 기반 검색 ===');
                
                const allLinks = document.querySelectorAll('a');
                for (let link of allLinks) {
                    const parentRow = link.closest('tr');
                    if (parentRow) {
                        const rowText = parentRow.textContent || '';
                        
                        if ((rowText.includes('10:30') || rowText.includes('10시30분')) && 
                            !rowText.includes('09:30') && !rowText.includes('09시30분')) {
                            
                            const linkText = link.textContent.trim();
                            console.log(`10:30 행의 링크 발견: ${linkText}`);
                            
                            if (linkText === '예약하기') {
                                console.log('🎯 10:30 예약하기 링크 직접 클릭!');
                                link.click();
                                return {
                                    found: true,
                                    booked: true,
                                    message: '10:30 수업 예약 (직접 링크)',
                                    needSubmit: true
                                };
                            } else if (linkText.includes('대기')) {
                                console.log('⏳ 10:30 대기예약 링크 직접 클릭');
                                link.click();
                                return {
                                    found: true,
                                    booked: true,
                                    message: '10:30 수업 대기예약 (직접 링크)',
                                    isWaitingOnly: true,
                                    needSubmit: true
                                };
                            }
                        }
                    }
                }
                
                return {
                    found: false,
                    booked: false,
                    message: '10:30 수업을 찾을 수 없음'
                };
            });
            
            await this.log(`🔍 검색 결과: ${result.message}`);
            
            // 예약 후 처리
            if (result.booked) {
                await this.log('⏳ 예약 처리 대기 중...');
                
                // 대기예약 confirm 처리
                if (result.isWaitingOnly) {
                    page.once('dialog', async dialog => {
                        await this.log(`📢 대기예약 확인: ${dialog.message()}`);
                        await dialog.accept();
                    });
                }
                
                await page.waitForTimeout(2000);
                
                // Submit 처리 (수정됨: 서버 부하 방지를 위한 짧은 대기 추가)
                if (result.needSubmit && !this.testMode) {
                    await this.log('📝 Submit 버튼 찾는 중...');
                    
                    // Submit 전 짧은 대기 (서버 부하 방지)
                    await page.waitForTimeout(500);
                    
                    const submitSuccess = await page.evaluate(() => {
                        // 모든 submit 관련 요소 찾기
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
                                console.log(`Submit 클릭: ${text}`);
                                elem.click();
                                return true;
                            }
                        }
                        
                        // form submit 시도
                        const forms = document.querySelectorAll('form');
                        if (forms.length > 0) {
                            console.log('Form submit 시도');
                            forms[0].submit();
                            return true;
                        }
                        
                        return false;
                    });
                    
                    if (submitSuccess) {
                        await this.log('✅ Submit 완료!');
                        await page.waitForTimeout(2000);
                        await this.takeScreenshot(page, '06-after-submit');
                    }
                }
                
                await this.takeScreenshot(page, '07-booking-result');
            }
            
            return result;
            
        } catch (error) {
            await this.log(`❌ 예약 과정 에러: ${error.message}`);
            await this.takeScreenshot(page, 'error-booking');
            throw error;
        }
    }

    async verifyBooking(page) {
        await this.log('🔍 예약 확인 중...');
        
        try {
            // 1. 현재 페이지에서 예약 성공 메시지 확인
            await page.waitForTimeout(3000);
            
            const currentPageSuccess = await page.evaluate(() => {
                const bodyText = document.body.innerText || document.body.textContent || '';
                console.log('현재 페이지 텍스트 샘플:', bodyText.substring(0, 500));
                
                const successPatterns = [
                    '예약완료',
                    '예약 완료',
                    '예약이 완료',
                    '예약되었습니다',
                    '예약 되었습니다',
                    '정상적으로 예약',
                    '대기예약 완료',
                    '대기 예약',
                    '예약신청이 완료'
                ];
                
                for (let pattern of successPatterns) {
                    if (bodyText.includes(pattern)) {
                        console.log(`✅ 성공 메시지 발견: ${pattern}`);
                        return true;
                    }
                }
                
                return false;
            });
            
            if (currentPageSuccess) {
                await this.log('✅ 예약 성공 메시지 확인!');
                await this.takeScreenshot(page, '08-booking-success-message');
                return true;
            }
            
            // 2. 예약 확인 페이지로 이동하여 확인
            await this.log('📋 예약 목록 페이지로 이동...');
            await page.goto(`${this.baseUrl}/yeapp/yeapp.php?tm=103`, {
                waitUntil: 'networkidle2'
            });
            
            await page.waitForTimeout(3000);
            await this.takeScreenshot(page, '08-booking-list-page');
            
            // 예약 내역 확인 (수정됨: KST 날짜 계산 로직 개선)
            const targetInfo = this.getTargetDate();
            const bookingVerified = await page.evaluate((targetInfo) => {
                const bodyText = document.body.innerText || document.body.textContent || '';
                
                const month = targetInfo.month;
                const day = targetInfo.day;
                
                console.log(`찾는 날짜: ${month}월 ${day}일 (KST 기준)`);
                
                // 다양한 형식으로 확인
                const dateFormats = [
                    `${month}월 ${day}일`,
                    `${month}/${day}`,
                    `${month}-${day}`,
                    `${month}.${day}`,
                    `2025-${month}-${day}`,
                    `2025.${month}.${day}`,
                    `2025/${month}/${day}`
                ];
                
                // 10:30 수업 확인
                if (bodyText.includes('10:30') || bodyText.includes('10시30분')) {
                    for (let format of dateFormats) {
                        if (bodyText.includes(format)) {
                            console.log(`✅ 예약 확인: ${format} 10:30`);
                            return { verified: true, format: format };
                        }
                    }
                    
                    if (bodyText.includes('10:30')) {
                        console.log('✅ 10:30 수업 예약 확인');
                        return { verified: true, format: '10:30 found' };
                    }
                }
                
                // 대기예약 확인
                if (bodyText.includes('*') && bodyText.includes('10:30')) {
                    console.log('✅ 10:30 대기예약 확인 (*)');
                    return { verified: true, isWaiting: true };
                }
                
                return { verified: false };
            }, targetInfo);
            
            if (bookingVerified.verified) {
                if (bookingVerified.isWaiting) {
                    await this.log('✅ 대기예약이 정상적으로 확인되었습니다!');
                } else {
                    await this.log(`✅ 예약이 정상적으로 확인되었습니다! (${bookingVerified.format})`);
                }
                return true;
            }
            
            // 3. 캘린더 페이지에서도 확인
            await this.log('📅 캘린더에서 확인 시도...');
            await page.goto(`${this.baseUrl}/yeapp/yeapp.php?tm=102`, {
                waitUntil: 'networkidle2'
            });
            
            await page.waitForTimeout(2000);
            
            const calendarVerified = await page.evaluate((targetDay) => {
                const cells = document.querySelectorAll('td');
                for (let cell of cells) {
                    const cellText = cell.textContent || '';
                    if (cellText.includes(String(targetDay)) && cellText.includes('*')) {
                        console.log(`✅ 캘린더에서 ${targetDay}일 예약 확인 (*)`);
                        return true;
                    }
                }
                return false;
            }, targetInfo.day);
            
            if (calendarVerified) {
                await this.log('✅ 캘린더에서 예약이 확인되었습니다!');
                await this.takeScreenshot(page, '08-calendar-verified');
                return true;
            }
            
            // 동시신청 오류인 경우 실패로 처리
            if (!this.bookingSuccess) {
                await this.log('❌ 예약 확인 실패 - 동시신청 오류 또는 예약 실패');
                return false;
            }
            
            await this.log('⚠️ 명시적 예약 확인 실패 - 예약 프로세스는 완료됨');
            return true;
            
        } catch (error) {
            await this.log(`⚠️ 예약 확인 과정 에러: ${error.message}`);
            return !this.bookingSuccess ? false : true;
        }
    }

    async run() {
        await this.init();
        
        let retryCount = 0;
        let success = false;
        
        while (retryCount < this.maxRetries && !success) {
            const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';
            const isCI = process.env.CI === 'true';
            
            const browser = await puppeteer.launch({
                headless: process.env.HEADLESS !== 'false' ? 'new' : false,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--disable-web-security',
                    '--disable-features=IsolateOrigins,site-per-process',
                    '--window-size=1920,1080',
                    '--lang=ko-KR',
                    ...(isGitHubActions || isCI ? ['--single-process', '--no-zygote'] : [])
                ]
            });
            
            try {
                const page = await browser.newPage();
                
                // 페이지 설정
                page.setDefaultTimeout(30000);
                await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
                await page.setViewport({ width: 1920, height: 1080 });
                
                // 콘솔 로그 캡처
                page.on('console', msg => {
                    if (msg.type() === 'log') {
                        this.log(`[브라우저]: ${msg.text()}`);
                    }
                });
                
                // 알림 처리 (수정됨: 동시신청 오류 처리 강화)
                page.on('dialog', async dialog => {
                    const message = dialog.message();
                    await this.log(`📢 알림: ${message}`);
                    
                    // 동시신청 오류 처리
                    if (message.includes('동시신청') || message.includes('잠시 후')) {
                        await dialog.accept();
                        await this.log('⚠️ 동시신청 충돌 - 재시도 필요');
                        this.bookingSuccess = false;
                        throw new Error('동시신청 충돌');
                    }
                    
                    // 시간 초과 오류
                    if (message.includes('시간초과') || message.includes('time out')) {
                        await dialog.accept();
                        await this.log('⚠️ 시간 초과 - 재시도 필요');
                        this.bookingSuccess = false;
                        throw new Error('시간 초과');
                    }
                    
                    // 예약 성공
                    if (message.includes('예약') && 
                        (message.includes('완료') || message.includes('성공') || message.includes('등록'))) {
                        this.bookingSuccess = true;
                        success = true;
                        await this.log('🎉 예약 성공 알림 확인!');
                    }
                    
                    // 로그인 오류
                    if (message.includes('등록되어 있지 않습니다')) {
                        await dialog.accept();
                        throw new Error('로그인 정보 오류');
                    }
                    
                    await dialog.accept();
                });
                
                // 1. 로그인
                await this.login(page);
                
                // 2. 예약 페이지로 이동
                const dateInfo = await this.navigateToBookingPage(page);
                
                // 3. 10:30 수업 찾고 예약
                const result = await this.find1030ClassAndBook(page);
                
                // 4. 결과 처리
                if (result.booked) {
                    await this.log('✅ 예약 프로세스 완료');
                    
                    let verified = false;
                    if (!this.testMode) {
                        verified = await this.verifyBooking(page);
                    }
                    
                    // 동시신청 오류가 발생했다면 재시도
                    if (!this.bookingSuccess && !verified) {
                        throw new Error('예약 확인 실패 - 동시신청 오류 가능성');
                    }
                    
                    success = true;
                    
                    // 결과 저장
                    const resultInfo = {
                        timestamp: this.getKSTDate().toISOString(),
                        date: `${dateInfo.year}-${dateInfo.month}-${dateInfo.day}`,
                        class: '10:30',
                        status: this.testMode ? 'TEST' : (result.isWaitingOnly ? 'WAITING' : 'SUCCESS'),
                        message: result.message,
                        verified: !this.testMode ? verified : null,
                        note: verified ? '예약 확인 완료' : '예약 프로세스 완료',
                        kstTime: this.getKSTDate().toLocaleString('ko-KR'),
                        bookingSuccess: this.bookingSuccess
                    };
                    
                    const resultFile = this.testMode ? 'test-result.json' : 'booking-result.json';
                    await fs.writeFile(
                        resultFile,
                        JSON.stringify(resultInfo, null, 2)
                    );
                    
                    await this.log('🎉🎉🎉 예약 프로세스 성공! 🎉🎉🎉');
                    
                    if (result.isWaitingOnly) {
                        await this.log('⚠️ 대기예약으로 등록되었습니다.');
                    }
                } else if (result.found) {
                    if (result.message.includes('이미 예약')) {
                        await this.log('✅ 이미 예약되어 있음 - 정상 상태');
                        success = true;
                        
                        const resultInfo = {
                            timestamp: this.getKSTDate().toISOString(),
                            date: `${dateInfo.year}-${dateInfo.month}-${dateInfo.day}`,
                            class: '10:30',
                            status: 'ALREADY_BOOKED',
                            message: '이미 예약되어 있음',
                            verified: true,
                            kstTime: this.getKSTDate().toLocaleString('ko-KR')
                        };
                        
                        const resultFile = this.testMode ? 'test-result.json' : 'booking-result.json';
                        await fs.writeFile(
                            resultFile,
                            JSON.stringify(resultInfo, null, 2)
                        );
                    } else {
                        break;
                    }
                } else {
                    throw new Error('10:30 수업을 찾을 수 없음');
                }
                
            } catch (error) {
                retryCount++;
                await this.log(`❌ 시도 ${retryCount}/${this.maxRetries} 실패: ${error.message}`);
                
                if (retryCount < this.maxRetries) {
                    // 동시신청 오류시 더 긴 대기 (수정됨)
                    const delay = error.message.includes('동시신청') ? 3000 : this.retryDelay;
                    await this.log(`⏳ ${delay/1000}초 후 재시도...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            } finally {
                await browser.close();
            }
        }
        
        if (!success) {
            await this.log('❌❌❌ 예약 실패 ❌❌❌');
            
            // 실패 결과 저장
            const targetInfo = this.getTargetDate();
            const resultInfo = {
                timestamp: this.getKSTDate().toISOString(),
                date: `${targetInfo.year}-${targetInfo.month}-${targetInfo.day}`,
                class: '10:30',
                status: 'FAILED',
                message: '예약 실패 - 동시신청 충돌 또는 시스템 오류',
                kstTime: this.getKSTDate().toLocaleString('ko-KR'),
                bookingSuccess: false
            };
            
            const resultFile = this.testMode ? 'test-result.json' : 'booking-result.json';
            await fs.writeFile(
                resultFile,
                JSON.stringify(resultInfo, null, 2)
            );
            
            process.exit(1);
        }
    }
}

// 환경변수 확인
if (!process.env.PILATES_USERNAME || !process.env.PILATES_PASSWORD) {
    console.error('❌ 환경변수가 필요합니다:');
    console.error('   PILATES_USERNAME: 회원이름');
    console.error('   PILATES_PASSWORD: 회원번호');
    console.error('');
    console.error('💡 설정 방법:');
    console.error('   1. .env 파일 생성 (로컬)');
    console.error('   2. GitHub Secrets 설정 (GitHub Actions)');
    process.exit(1);
}

// 실행
const booking = new PilatesBooking();
booking.run().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
