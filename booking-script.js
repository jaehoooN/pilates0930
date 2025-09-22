// 필라테스 자동 예약 시스템 v6.1 - 주말 로직 수정 버전
require('dotenv').config();

const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');

class PreciseTimingPilatesBooking {
    constructor() {
        this.username = process.env.PILATES_USERNAME;
        this.password = process.env.PILATES_PASSWORD;
        this.baseUrl = 'https://ad2.mbgym.kr';
        this.maxRetries = parseInt(process.env.RETRY_COUNT) || 2;
        this.retryDelay = 500;
        
        // GitHub Actions 환경 감지
        this.isGitHubActions = process.env.GITHUB_ACTIONS === 'true';
        this.executionMode = process.env.EXECUTION_MODE || 'manual';
        this.timingInfo = process.env.TIMING_INFO || '';
        
        // 모드 설정
        this.testMode = process.env.TEST_MODE === 'true';
        this.immediateMode = process.env.IMMEDIATE_MODE === 'true';
        this.debugMode = process.env.DEBUG === 'true';
        
        // 타이밍 설정
        this.targetTime = process.env.TARGET_TIME || '00:01:00';
        this.maxWaitMinutes = parseInt(process.env.MAX_WAIT_MINUTES) || 20;
        
        // 상태 플래그
        this.bookingSuccess = false;
        this.isWaitingReservation = false;
        this.hasConflictError = false;
        this.waitingStartTime = null;
        this.actualStartTime = null;
        
        // 성능 최적화 설정
        this.optimizations = {
            fastTimeout: 15000,
            skipNonEssentialScreenshots: this.isGitHubActions,
            screenshotQuality: parseInt(process.env.SCREENSHOT_QUALITY) || 50,
            resourceBlocking: true
        };
    }

    // 한국 시간 계산 (고정밀)
    getKSTDate() {
        const now = new Date();
        const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000);
        const kstOffset = 9 * 60 * 60 * 1000;
        return new Date(utcTime + kstOffset);
    }

    // 정밀 시간 문자열 (밀리초 포함)
    getKSTTimeString(includeMillis = true) {
        const kst = this.getKSTDate();
        if (includeMillis) {
            return kst.toISOString().replace('Z', '+09:00').replace('T', ' ');
        }
        return kst.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
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
            kstString: targetDate.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }),
            isWeekend: targetDate.getDay() === 0 || targetDate.getDay() === 6
        };
    }

    // 요일 이름
    getDayName(date) {
        const days = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
        return days[date.getDay()];
    }

    // 고급 로깅 시스템
    async log(message, level = 'INFO') {
        const timestamp = this.getKSTTimeString();
        const prefix = this.debugMode ? `[${level}]` : '';
        const logMessage = `[${timestamp}] ${prefix} ${message}`;
        
        console.log(logMessage);
        
        // GitHub Actions가 아닌 경우에만 파일 로그
        if (!this.isGitHubActions) {
            try {
                const logDir = 'logs';
                await fs.mkdir(logDir, { recursive: true });
                const logFile = this.testMode ? 'logs/test.log' : 'logs/booking.log';
                await fs.appendFile(logFile, logMessage + '\n');
            } catch (error) {
                // 로그 파일 쓰기 실패는 무시
            }
        }
    }

    // 디버그 로그
    async debug(message) {
        if (this.debugMode) {
            await this.log(`🔧 ${message}`, 'DEBUG');
        }
    }

    // 초기화 및 환경 확인 (수정됨 - 주말 로직)
    async init() {
        try {
            await fs.mkdir('screenshots', { recursive: true });
            await fs.mkdir('logs', { recursive: true });
        } catch (err) {
            // 무시
        }
        
        const kstNow = this.getKSTDate();
        const targetInfo = this.getTargetDate();
        
        await this.log(`=== 필라테스 자동 예약 시스템 v6.1 시작 ===`);
        await this.log(`🕐 현재 KST: ${this.getKSTTimeString()}`);
        await this.log(`🎯 실행 모드: ${this.executionMode}`);
        await this.log(`⏰ 타이밍 정보: ${this.timingInfo}`);
        await this.log(`📅 예약 대상: ${targetInfo.year}년 ${targetInfo.month}월 ${targetInfo.day}일 (${this.getDayName(targetInfo.dateObject)})`);
        
        // 주말 체크 로직 수정 - 현재 요일 기준으로 판단
        const currentDayOfWeek = kstNow.getDay(); // 0=일, 1=월, ... 6=토
        const currentDayName = this.getDayName(kstNow);
        
        await this.log(`📅 현재 요일: ${currentDayName} (${currentDayOfWeek})`);
        
        // 금요일(5) 또는 토요일(6)에 실행되면 스킵
        // 금요일 23:55 → 다음날(토요일) 예약 → 스킵
        // 토요일 23:55 → 다음날(일요일) 예약 → 스킵
        // 일요일 23:55 → 다음날(월요일) 예약 → 실행!
        
        if (!this.testMode && this.executionMode !== 'force' && this.executionMode !== 'manual-force') {
            if (currentDayOfWeek === 5) {
                await this.log(`🚫 금요일 실행 - 토요일 예약이므로 스킵`);
                
                const resultInfo = {
                    timestamp: this.getKSTDate().toISOString(),
                    date: `${targetInfo.year}-${targetInfo.month}-${targetInfo.day}`,
                    dayOfWeek: this.getDayName(targetInfo.dateObject),
                    currentDay: currentDayName,
                    status: 'WEEKEND_SKIP',
                    message: '금요일 → 토요일 예약 스킵',
                    executionMode: this.executionMode,
                    timingInfo: this.timingInfo,
                    githubActions: this.isGitHubActions
                };
                
                await this.saveResult(resultInfo);
                process.exit(0);
                
            } else if (currentDayOfWeek === 6) {
                await this.log(`🚫 토요일 실행 - 일요일 예약이므로 스킵`);
                
                const resultInfo = {
                    timestamp: this.getKSTDate().toISOString(),
                    date: `${targetInfo.year}-${targetInfo.month}-${targetInfo.day}`,
                    dayOfWeek: this.getDayName(targetInfo.dateObject),
                    currentDay: currentDayName,
                    status: 'WEEKEND_SKIP',
                    message: '토요일 → 일요일 예약 스킵',
                    executionMode: this.executionMode,
                    timingInfo: this.timingInfo,
                    githubActions: this.isGitHubActions
                };
                
                await this.saveResult(resultInfo);
                process.exit(0);
            }
        }
        
        if (currentDayOfWeek === 0) {
            await this.log(`✅ 일요일 실행 - 월요일 예약 진행`);
        } else if (currentDayOfWeek >= 1 && currentDayOfWeek <= 4) {
            await this.log(`✅ 평일 실행 - 예약 진행`);
        } else if (this.testMode) {
            await this.log(`🧪 테스트 모드 - 주말 체크 무시`);
        } else if (this.executionMode === 'force' || this.executionMode === 'manual-force') {
            await this.log(`🔧 강제 실행 모드 - 주말 체크 무시`);
        }
        
        if (this.testMode) {
            await this.log('🧪 테스트 모드 실행 중');
        }
        
        if (this.immediateMode) {
            await this.log('🚀 즉시 실행 모드 - 대기 없음');
        }
    }

    // 정밀 대기 시스템
    async waitUntilTargetTime() {
        if (this.immediateMode) {
            await this.log('🚀 즉시 실행 모드 - 대기 생략');
            return;
        }

        await this.log('⏰ 정밀 대기 시스템 시작');
        
        // 목표 시간 파싱
        const [targetHour, targetMinute, targetSecond] = this.targetTime.split(':').map(Number);
        await this.log(`🎯 목표 시간: ${this.targetTime}`);
        
        this.waitingStartTime = this.getKSTDate();
        
        // 대기 시간 계산
        const calculateWaitTime = () => {
            const now = this.getKSTDate();
            const currentHour = now.getHours();
            const currentMinute = now.getMinutes();
            const currentSecond = now.getSeconds();
            
            // 현재 시간을 초로 변환
            const currentTotalSeconds = currentHour * 3600 + currentMinute * 60 + currentSecond;
            
            // 목표 시간을 초로 변환 (자정 이후 고려)
            let targetTotalSeconds = targetHour * 3600 + targetMinute * 60 + targetSecond;
            
            // 자정을 넘어가는 경우 (23시대 → 00시대)
            if (currentHour >= 23 && targetHour < 12) {
                targetTotalSeconds += 24 * 3600; // 다음날로 계산
            }
            
            const waitSeconds = targetTotalSeconds - currentTotalSeconds;
            return Math.max(0, waitSeconds);
        };
        
        let waitSeconds = calculateWaitTime();
        const waitMinutes = Math.floor(waitSeconds / 60);
        
        if (waitSeconds <= 0) {
            await this.log('⚠️ 목표 시간이 이미 지났거나 현재 시간 - 즉시 실행');
            return;
        }
        
        if (waitMinutes > this.maxWaitMinutes) {
            await this.log(`⚠️ 대기 시간이 ${waitMinutes}분으로 최대 대기 시간(${this.maxWaitMinutes}분)을 초과 - 즉시 실행`);
            return;
        }
        
        await this.log(`⏳ 총 대기 시간: ${waitMinutes}분 ${waitSeconds % 60}초`);
        
        // 단계별 대기 (분 단위)
        if (waitMinutes > 0) {
            await this.log(`📅 ${waitMinutes}분 대기 시작...`);
            
            for (let i = waitMinutes; i > 0; i--) {
                const currentTime = this.getKSTTimeString(false);
                
                if (i <= 5) {
                    await this.log(`⏳ ${i}분 남음 (현재: ${currentTime})`);
                } else if (i % 5 === 0) {
                    await this.log(`⏳ ${i}분 남음 (현재: ${currentTime})`);
                }
                
                // 마지막 2분은 더 세밀하게 확인
                if (i <= 2) {
                    await new Promise(resolve => setTimeout(resolve, 30000)); // 30초 대기
                    await new Promise(resolve => setTimeout(resolve, 30000)); // 30초 대기
                } else {
                    await new Promise(resolve => setTimeout(resolve, 60000)); // 1분 대기
                }
                
                // 목표 시간 재계산 (시간이 흘렀으므로)
                waitSeconds = calculateWaitTime();
                if (waitSeconds <= 60) {
                    await this.log('🎯 1분 이내 도달 - 초 단위 정밀 제어로 전환');
                    break;
                }
            }
        }
        
        // 초 단위 정밀 대기
        await this.log('🎯 초 단위 정밀 대기 시작');
        
        while (true) {
            const now = this.getKSTDate();
            const currentHour = now.getHours();
            const currentMinute = now.getMinutes();
            const currentSecond = now.getSeconds();
            const currentMillis = now.getMilliseconds();
            
            // 목표 시간 도달 확인
            const timeMatch = (
                currentHour === targetHour &&
                currentMinute === targetMinute &&
                currentSecond >= targetSecond
            );
            
            if (timeMatch) {
                await this.log(`🎯 목표 시간 도달! ${currentHour.toString().padStart(2,'0')}:${currentMinute.toString().padStart(2,'0')}:${currentSecond.toString().padStart(2,'0')}.${currentMillis.toString().padStart(3,'0')}`);
                break;
            }
            
            // 목표 시간을 지났는지 확인
            const currentTotal = currentHour * 3600 + currentMinute * 60 + currentSecond;
            const targetTotal = targetHour * 3600 + targetMinute * 60 + targetSecond;
            
            if (currentTotal > targetTotal && currentHour < 23) {
                await this.log('⚠️ 목표 시간 경과 - 즉시 실행');
                break;
            }
            
            const remaining = targetTotal - currentTotal;
            
            if (remaining <= 10 && remaining > 0) {
                await this.log(`🔥 ${remaining}초 남음...`);
                await new Promise(resolve => setTimeout(resolve, 200)); // 200ms 대기
            } else if (remaining <= 30) {
                if (remaining % 5 === 0) {
                    await this.log(`⏰ ${remaining}초 남음`);
                }
                await new Promise(resolve => setTimeout(resolve, 1000)); // 1초 대기
            } else {
                await new Promise(resolve => setTimeout(resolve, 2000)); // 2초 대기
            }
        }
        
        this.actualStartTime = this.getKSTDate();
        const waitDuration = this.actualStartTime - this.waitingStartTime;
        const waitMinutesActual = Math.floor(waitDuration / 60000);
        const waitSecondsActual = Math.floor((waitDuration % 60000) / 1000);
        
        await this.log(`✅ 정밀 대기 완료 - 실제 대기: ${waitMinutesActual}분 ${waitSecondsActual}초`);
        await this.log(`🚀 예약 실행 시작: ${this.getKSTTimeString()}`);
    }

    // 스크린샷
    async takeScreenshot(page, name) {
        if (this.optimizations.skipNonEssentialScreenshots && name.includes('optional')) {
            return null;
        }
        
        try {
            const timestamp = Date.now();
            const prefix = this.testMode ? 'test-' : '';
            const filename = `screenshots/${prefix}${name}-${timestamp}.png`;
            
            await page.screenshot({ 
                path: filename, 
                fullPage: false,
                quality: this.optimizations.screenshotQuality
            });
            
            await this.debug(`📸 스크린샷: ${filename}`);
            return filename;
        } catch (error) {
            await this.debug(`⚠️ 스크린샷 실패: ${error.message}`);
            return null;
        }
    }

    // 고성능 로그인
    async login(page) {
        await this.log('🔐 로그인 시도...');
        
        try {
            // 리소스 차단 설정
            if (this.optimizations.resourceBlocking) {
                await page.setRequestInterception(true);
                page.on('request', (request) => {
                    const resourceType = request.resourceType();
                    if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
                        request.abort();
                    } else {
                        request.continue();
                    }
                });
            }
            
            // 로그인 페이지 이동
            await this.debug('로그인 페이지 이동 중...');
            await page.goto(`${this.baseUrl}/yeapp/yeapp.php?tm=102`, {
                waitUntil: 'domcontentloaded',
                timeout: this.optimizations.fastTimeout
            });
            
            await this.takeScreenshot(page, '01-login');
            
            // 이미 로그인 확인
            const logoutLink = await page.$('a[href*="yeout.php"]');
            if (logoutLink) {
                await this.log('✅ 이미 로그인됨');
                return true;
            }
            
            // 로그인 폼 대기 및 입력
            await this.debug('로그인 폼 대기 중...');
            await page.waitForSelector('input#user_id, input[name="name"]', { 
                timeout: this.optimizations.fastTimeout 
            });
            
            const useridSelector = await page.$('input#user_id') ? 'input#user_id' : 'input[name="name"]';
            const passwdSelector = await page.$('input#passwd') ? 'input#passwd' : 'input[name="passwd"]';
            
            // 빠른 입력 (evaluate 사용)
            await page.evaluate((selector, value) => {
                const input = document.querySelector(selector);
                if (input) {
                    input.value = value;
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                }
            }, useridSelector, this.username);
            
            await page.evaluate((selector, value) => {
                const input = document.querySelector(selector);
                if (input) {
                    input.value = value;
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                }
            }, passwdSelector, this.password);
            
            await this.log(`📝 로그인 정보 입력 완료: ${this.username}`);
            
            // 로그인 실행
            const submitButton = await page.$('input[type="submit"]');
            if (submitButton) {
                await this.debug('로그인 버튼 클릭...');
                await Promise.all([
                    page.waitForNavigation({ 
                        waitUntil: 'domcontentloaded',
                        timeout: this.optimizations.fastTimeout 
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

    // 예약 페이지 이동
    async navigateToBookingPage(page) {
        await this.log('📅 예약 페이지 이동...');
        
        const targetInfo = this.getTargetDate();
        const { year, month, day } = targetInfo;
        
        await this.log(`📆 목표 날짜: ${year}년 ${month}월 ${day}일`);
        
        try {
            // 현재 페이지 확인
            const currentUrl = page.url();
            if (!currentUrl.includes('res_postform.php')) {
                await this.debug('예약 페이지로 이동 중...');
                // 예약 페이지로 이동하는 로직 추가 가능
            }
            
            // 날짜 클릭
            await this.debug(`${day}일 날짜 클릭 시도...`);
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
                await page.waitForTimeout(2000);
            } else {
                await this.log(`⚠️ ${day}일 클릭 실패 - 날짜를 찾을 수 없음`);
            }
            
            await this.takeScreenshot(page, '03-booking-page');
            return { year, month, day };
            
        } catch (error) {
            await this.log(`❌ 예약 페이지 이동 실패: ${error.message}`);
            throw error;
        }
    }

    // 09:30 수업 검색 및 예약
    async find0930ClassAndBook(page) {
        await this.log('🔍 09:30 수업 검색 및 예약...');
        
        this.hasConflictError = false;
        
        try {
            // 테이블 로드 대기
            await page.waitForSelector('table', { 
                timeout: this.optimizations.fastTimeout 
            }).catch(() => {
                this.log('⚠️ 테이블 로드 타임아웃');
            });
            
            await this.takeScreenshot(page, '04-time-table');
            
            // 다이얼로그 핸들러 설정
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
                        await this.log('🎉 요일별 예약횟수 완료 - 성공으로 처리');
                        return;
                    }
                    
                    if (message.includes('동시신청') || message.includes('잠시 후')) {
                        this.hasConflictError = true;
                        await dialog.accept();
                        await this.log('⚠️ 동시신청 충돌 감지');
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
            
            // 09:30 수업 검색 및 예약 실행
            const result = await page.evaluate(() => {
                console.log('=== 09:30 수업 검색 시작 ===');
                
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
                                    console.log(`09:30 상태 확인: "${actionText}"`);
                                    
                                    // 이미 예약된 경우
                                    if (actionText.includes('예약완료') || actionText.includes('대기완료') || 
                                        actionText.includes('삭제') || actionText.includes('취소')) {
                                        return {
                                            found: true,
                                            booked: false,
                                            alreadyBooked: true,
                                            isWaiting: actionText.includes('대기완료'),
                                            message: `09:30 수업 이미 ${actionText.includes('대기완료') ? '대기예약' : '예약'} 완료`
                                        };
                                    }
                                    
                                    // 예약 가능한 경우
                                    const link = actionCell.querySelector('a');
                                    
                                    if (actionText.includes('예약하기')) {
                                        if (link) {
                                            console.log('🎯 09:30 예약하기 클릭 실행');
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
                                            console.log('⏳ 09:30 대기예약 클릭 실행');
                                            link.click();
                                            return {
                                                found: true,
                                                booked: true,
                                                message: '09:30 수업 대기예약 클릭',
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
                await this.log('⚠️ 예약불가 상태 - 정원 초과 또는 시간 경과');
                page.off('dialog', dialogHandler);
                return result;
            }
            
            if (result.alreadyBooked) {
                await this.log('✅ 이미 예약 완료 - 중복 예약 방지 작동');
                this.bookingSuccess = true;
                if (result.isWaiting) {
                    this.isWaitingReservation = true;
                }
                page.off('dialog', dialogHandler);
                return result;
            }
            
            // 예약 후 처리
            if (result.booked) {
                await this.log('⏳ 예약 처리 중...');
                
                if (result.isWaitingOnly) {
                    // 대기예약의 경우
                    await page.waitForTimeout(2000);
                } else if (result.needSubmit && !this.testMode) {
                    // 일반 예약의 경우 Submit 처리
                    await this.log('📝 Submit 버튼 처리...');
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
                        
                        // Form submit 시도
                        const forms = document.querySelectorAll('form');
                        if (forms.length > 0) {
                            forms[0].submit();
                            return true;
                        }
                        
                        return false;
                    });
                    
                    if (submitSuccess) {
                        await this.log('✅ Submit 버튼 클릭 완료');
                        await page.waitForTimeout(1500);
                        
                        if (this.hasConflictError) {
                            page.off('dialog', dialogHandler);
                            throw new Error('동시신청 충돌 발생');
                        }
                        
                        await this.takeScreenshot(page, '06-submit-result');
                    } else {
                        await this.log('⚠️ Submit 버튼을 찾을 수 없음');
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

    // 결과 검증 (캘린더 확인)
    async verifyBooking(page) {
        try {
            await this.log('🔍 예약 결과 검증 중...');
            
            // 캘린더로 이동하여 * 표시 확인
            const hasAsterisk = await page.evaluate(() => {
                const cells = document.querySelectorAll('td');
                for (let cell of cells) {
                    if (cell.textContent.includes('*')) {
                        return true;
                    }
                }
                return false;
            });
            
            if (hasAsterisk) {
                await this.log('✅ 캘린더에 * 표시 확인 - 예약 검증 성공');
                return true;
            } else {
                await this.log('⚠️ 캘린더에 * 표시 없음 - 검증 실패');
                return false;
            }
            
        } catch (error) {
            await this.log(`⚠️ 예약 검증 오류: ${error.message}`);
            return false;
        }
    }

    // 결과 저장
    async saveResult(resultInfo) {
        const resultFile = this.testMode ? 'test-result.json' : 'booking-result.json';
        
        try {
            // 추가 메타데이터
            const enhancedResult = {
                ...resultInfo,
                version: '6.1.0',
                waitingStartTime: this.waitingStartTime?.toISOString(),
                actualStartTime: this.actualStartTime?.toISOString(),
                executionDuration: this.actualStartTime && this.waitingStartTime ? 
                    (this.actualStartTime - this.waitingStartTime) : null,
                systemInfo: {
                    isGitHubActions: this.isGitHubActions,
                    executionMode: this.executionMode,
                    targetTime: this.targetTime,
                    immediateMode: this.immediateMode,
                    debugMode: this.debugMode
                }
            };
            
            await fs.writeFile(resultFile, JSON.stringify(enhancedResult, null, 2));
            await this.log(`💾 결과 저장 완료: ${resultFile}`);
            
        } catch (error) {
            await this.log(`⚠️ 결과 저장 실패: ${error.message}`);
        }
    }

    // 메인 실행 로직
    async run() {
        await this.init();
        
        // 정밀 대기 실행
        await this.waitUntilTargetTime();
        
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
                    '--window-size=1280,720'
                ]
            });
            
            try {
                const page = await browser.newPage();
                
                // 페이지 설정
                page.setDefaultTimeout(this.optimizations.fastTimeout);
                await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36');
                await page.setViewport({ width: 1280, height: 720 });
                
                // 콘솔 로그 캡처 (디버그 모드에서만)
                if (this.debugMode) {
                    page.on('console', msg => {
                        if (msg.type() === 'log') {
                            this.debug(`[브라우저]: ${msg.text()}`);
                        }
                    });
                }
                
                // 1. 로그인
                await this.login(page);
                
                // 2. 예약 페이지 이동
                const dateInfo = await this.navigateToBookingPage(page);
                
                // 3. 09:30 수업 예약
                const result = await this.find0930ClassAndBook(page);
                
                // 4. 결과 검증 (선택적)
                let verified = false;
                if (result.booked || result.alreadyBooked) {
                    verified = await this.verifyBooking(page);
                }
                
                // 5. 결과 처리
                if (result.booked || result.alreadyBooked || result.unavailable) {
                    await this.log('✅ 예약 프로세스 완료');
                    success = true;
                    
                    // 최종 결과 저장
                    const resultInfo = {
                        timestamp: this.getKSTDate().toISOString(),
                        date: `${dateInfo.year}-${dateInfo.month}-${dateInfo.day}`,
                        class: '09:30',
                        status: this.testMode ? 'TEST' : 
                               result.unavailable ? 'UNAVAILABLE' :
                               result.alreadyBooked ? (result.isWaiting ? 'ALREADY_WAITING' : 'ALREADY_BOOKED') :
                               (this.isWaitingReservation ? 'WAITING' : 'SUCCESS'),
                        message: result.message,
                        verified: verified,
                        retryCount: retryCount,
                        bookingSuccess: result.unavailable ? false : this.bookingSuccess,
                        isWaitingReservation: this.isWaitingReservation,
                        note: result.alreadyBooked ? '중복 예약 방지 작동' : 
                              this.isWaitingReservation ? '대기예약 등록' : '일반예약 성공'
                    };
                    
                    await this.saveResult(resultInfo);
                    
                    // 상태별 최종 로그
                    if (result.unavailable) {
                        await this.log('⚠️ 예약불가 - 정원 초과 또는 시간 경과');
                    } else {
                        await this.log('🎉 예약 프로세스 성공!');
                        if (this.isWaitingReservation) {
                            await this.log('📋 대기예약으로 등록됨');
                        }
                        if (result.alreadyBooked) {
                            await this.log('🛡️ 중복 예약 방지 시스템 작동');
                        }
                        if (verified) {
                            await this.log('✅ 캘린더 검증 완료');
                        }
                    }
                    
                } else {
                    throw new Error(result.found ? '예약 처리 실패' : '09:30 수업 없음');
                }
                
            } catch (error) {
                retryCount++;
                await this.log(`❌ 시도 ${retryCount}/${this.maxRetries} 실패: ${error.message}`);
                
                if (retryCount < this.maxRetries) {
                    await this.log(`🔄 ${this.retryDelay}ms 후 재시도`);
                    await new Promise(resolve => setTimeout(resolve, this.retryDelay));
                }
                
            } finally {
                await browser.close();
            }
        }
        
        if (!success) {
            await this.log('❌ 모든 시도 실패');
            
            const targetInfo = this.getTargetDate();
            const resultInfo = {
                timestamp: this.getKSTDate().toISOString(),
                date: `${targetInfo.year}-${targetInfo.month}-${targetInfo.day}`,
                class: '09:30',
                status: 'FAILED',
                message: '모든 재시도 실패',
                bookingSuccess: false,
                retryCount: this.maxRetries
            };
            
            await this.saveResult(resultInfo);
            process.exit(1);
        }
    }
}

// 환경변수 확인
if (!process.env.PILATES_USERNAME || !process.env.PILATES_PASSWORD) {
    console.error('❌ 필수 환경변수 누락: PILATES_USERNAME, PILATES_PASSWORD');
    console.error('💡 .env 파일을 확인하거나 GitHub Secrets를 설정하세요');
    process.exit(1);
}

// 실행
const booking = new PreciseTimingPilatesBooking();
booking.run().catch(error => {
    console.error('💥 치명적 오류:', error);
    process.exit(1);
});
