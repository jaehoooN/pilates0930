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
        
        // 대기예약 플래그 추가
        this.isWaitingReservation = false;
        
        // 동시신청 충돌 플래그 추가
        this.hasConflictError = false;
        
        // 시간초과 플래그 추가
        this.hasTimeoutError = false;
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

    // 랜덤 지연 추가 (동시신청 충돌 방지)
    async addRandomDelay() {
        // 0~3초 사이의 랜덤 지연 (자정 직후 동시 접속 분산)
        const randomDelay = Math.floor(Math.random() * 3000);
        await this.log(`⏱️ 동시접속 분산을 위한 랜덤 대기: ${randomDelay}ms`);
        await new Promise(resolve => setTimeout(resolve, randomDelay));
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
        
        // 자정 직후인 경우 랜덤 지연 추가
        const hour = kstNow.getHours();
        const minute = kstNow.getMinutes();
        if (hour === 0 && minute < 5) {
            await this.addRandomDelay();
        }
        
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
            
            // 해당 날짜 클릭 - 더 정확한 날짜 선택
            const dateClicked = await page.evaluate((targetDay) => {
                const cells = document.querySelectorAll('td');
                
                for (let cell of cells) {
                    const text = cell.textContent.trim();
                    
                    // 정확한 날짜 매칭 - 숫자만 있거나 숫자로 시작하는 경우
                    const regex = new RegExp(`^${targetDay}(\\s|$|[^0-9])`);
                    if (regex.test(text) && !text.includes('X')) {
                        
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

    // 09:30 수업 찾기 및 예약하기 - 중복 예약 방지 및 개선된 버전
    async find0930ClassAndBook(page) {
        await this.log('🔍 09:30 수업 찾는 중...');
        
        // 플래그 초기화
        this.hasConflictError = false;
        this.hasTimeoutError = false;
        
        try {
            await page.waitForSelector('table', { timeout: 5000 }).catch(() => {
                this.log('⚠️ 테이블 로드 대기 시간 초과');
            });
            
            await this.takeScreenshot(page, '04-time-table');
            
            // 대기예약 confirm 핸들러 설정 (개선된 버전)
            let waitingDialogHandled = false;
            const dialogHandler = async (dialog) => {
                const message = dialog.message();
                await this.log(`📢 알림: ${message}`);
                
                // 대기예약 확인 다이얼로그 - 정확한 메시지 매칭
                if (message.includes('정원이 초과') && message.includes('대기예약을 하시겠습니까')) {
                    if (!waitingDialogHandled) {
                        waitingDialogHandled = true;
                        this.isWaitingReservation = true;
                        this.bookingSuccess = true; // 대기예약도 성공으로 간주
                        await dialog.accept();
                        await this.log('✅ 대기예약 확인 완료');
                    }
                    return;
                }
                
                // 요일별 예약횟수 완료 알림 - 새로 추가
                if (message.includes('요일별 예약횟수가 완료')) {
                    this.bookingSuccess = true;
                    await dialog.accept();
                    await this.log('🎉 요일별 예약횟수 완료 - 예약 성공!');
                    return;
                }
                
                // 날짜 선택 오류
                if (message.includes('날짜를 선택')) {
                    await dialog.accept();
                    await this.log('⚠️ 날짜 선택 오류 - 재시도 필요');
                    this.hasConflictError = true;
                    return;
                }
                
                // 동시신청 오류 - throw 대신 플래그 설정
                if (message.includes('동시신청') || message.includes('잠시 후')) {
                    await dialog.accept();
                    await this.log('⚠️ 동시신청 충돌 - 재시도 필요');
                    this.bookingSuccess = false;
                    this.hasConflictError = true;
                    return;
                }
                
                // 시간 초과 오류 - throw 대신 플래그 설정
                if (message.includes('시간초과') || message.includes('time out')) {
                    await dialog.accept();
                    await this.log('⚠️ 시간 초과 - 재시도 필요');
                    this.bookingSuccess = false;
                    this.hasTimeoutError = true;
                    return;
                }
                
                // 예약 성공
                if (message.includes('예약') && 
                    (message.includes('완료') || message.includes('성공') || message.includes('등록'))) {
                    this.bookingSuccess = true;
                    await dialog.accept();
                    await this.log('🎉 예약 성공 알림 확인!');
                    return;
                }
                
                // 타임 선택 오류 - throw 대신 플래그 설정
                if (message.includes('선택된 타임이 없습니다') || message.includes('예약선택을 하십시오')) {
                    await dialog.accept();
                    await this.log('⚠️ 타임 선택 오류 - 잘못된 시간대 선택됨');
                    this.hasConflictError = true;
                    return;
                }
                
                // 로그인 오류
                if (message.includes('등록되어 있지 않습니다')) {
                    await dialog.accept();
                    this.hasConflictError = true;
                    return;
                }
                
                // 기타 다이얼로그
                await dialog.accept();
            };
            
            // 다이얼로그 핸들러 등록
            page.on('dialog', dialogHandler);
            
            // 09:30 수업 검색 및 예약 - 중복 예약 방지 개선된 로직
            const result = await page.evaluate(() => {
                console.log('=== 09:30 수업 검색 시작 ===');
                
                // 모든 테이블 행을 검색
                const allRows = document.querySelectorAll('tr');
                console.log(`전체 행 수: ${allRows.length}`);
                
                // 첫 번째 패스: 이미 예약된 09:30 수업이 있는지 확인
                let hasExisting0930Booking = false;
                let existingBookingType = '';
                
                for (let i = 0; i < allRows.length; i++) {
                    const row = allRows[i];
                    const rowText = row.textContent || '';
                    
                    // 09:30이 포함되어 있는지 확인 (오전 수업만)
                    if ((rowText.includes('09:30') || rowText.includes('09시30분') || rowText.includes('9:30')) && 
                        !rowText.includes('오후') && !rowText.includes('PM')) {
                        
                        const cells = row.querySelectorAll('td');
                        if (cells.length >= 3) {
                            // 시간 셀 찾기
                            for (let j = 0; j < cells.length; j++) {
                                const cellText = cells[j].textContent.trim();
                                
                                // 시간 셀 확인 (오전 09:30만)
                                if (cellText === '오전 09:30' || cellText === '오전 9:30' ||
                                    cellText.includes('09:30') || cellText.includes('9:30') ||
                                    cellText.includes('09시30분') || cellText.includes('9시30분')) {
                                    
                                    // 예약 상태 셀 찾기
                                    let actionCell = cells[cells.length - 1];
                                    if (j < cells.length - 1) {
                                        const nextCell = cells[j + 1];
                                        if (nextCell.textContent.includes('예약') || 
                                            nextCell.textContent.includes('대기') ||
                                            nextCell.textContent.includes('완료')) {
                                            actionCell = nextCell;
                                        }
                                    }
                                    
                                    const actionText = actionCell.textContent.trim();
                                    console.log(`09:30 수업 상태 확인: ${actionText} (행 ${i})`);
                                    
                                    // 이미 예약/대기예약된 수업이 있는지 확인
                                    if (actionText.includes('예약완료') || actionText.includes('대기완료') || 
                                        actionText.includes('삭제') || actionText.includes('취소')) {
                                        hasExisting0930Booking = true;
                                        existingBookingType = actionText.includes('대기완료') ? '대기예약' : '예약';
                                        console.log(`✅ 이미 09:30 ${existingBookingType} 완료됨 (행 ${i})`);
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }
                
                // 이미 예약된 09:30 수업이 있으면 추가 예약 방지
                if (hasExisting0930Booking) {
                    return {
                        found: true,
                        booked: false,
                        alreadyBooked: true,
                        message: `09:30 수업 ${existingBookingType}이 이미 완료됨 - 중복 예약 방지`
                    };
                }
                
                // 두 번째 패스: 예약 가능한 09:30 수업 찾기
                for (let i = 0; i < allRows.length; i++) {
                    const row = allRows[i];
                    const rowText = row.textContent || '';
                    
                    // 09:30이 포함되어 있는지 확인 (오전 수업만)
                    if ((rowText.includes('09:30') || rowText.includes('09시30분') || rowText.includes('9:30')) && 
                        !rowText.includes('오후') && !rowText.includes('PM')) {
                        
                        const cells = row.querySelectorAll('td');
                        console.log(`09:30 포함 행 발견 (행 ${i}), 셀 수: ${cells.length}`);
                        
                        // 셀이 3개 이상인 경우만
                        if (cells.length >= 3) {
                            // 각 셀 내용 확인
                            for (let j = 0; j < cells.length; j++) {
                                const cellText = cells[j].textContent.trim();
                                console.log(`  셀 ${j}: ${cellText.substring(0, 30)}`);
                                
                                // 시간 셀 확인 (오전 09:30만)
                                if (cellText === '오전 09:30' || cellText === '오전 9:30' ||
                                    cellText.includes('09:30') || cellText.includes('9:30') ||
                                    cellText.includes('09시30분') || cellText.includes('9시30분')) {
                                    
                                    console.log(`✅ 09:30 시간 확인! 셀 인덱스: ${j}`);
                                    
                                    // 예약 버튼 찾기 (보통 마지막 셀)
                                    let actionCell = cells[cells.length - 1];
                                    
                                    // 시간 셀 다음이 예약 셀일 수도 있음
                                    if (j < cells.length - 1) {
                                        const nextCell = cells[j + 1];
                                        if (nextCell.textContent.includes('예약') || 
                                            nextCell.textContent.includes('대기') ||
                                            nextCell.textContent.includes('완료')) {
                                            actionCell = nextCell;
                                        }
                                    }
                                    
                                    const actionText = actionCell.textContent.trim();
                                    console.log(`예약 셀 내용: ${actionText}`);
                                    
                                    // 예약 상태별 처리
                                    const link = actionCell.querySelector('a');
                                    
                                    if (actionText.includes('예약하기')) {
                                        if (link) {
                                            console.log('🎯 09:30 예약하기 링크 클릭!');
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
                                            console.log('⏳ 09:30 대기예약 링크 클릭');
                                            link.click();
                                            return {
                                                found: true,
                                                booked: true,
                                                message: '09:30 수업 대기예약',
                                                isWaitingOnly: true,
                                                needSubmit: false // 대기예약은 confirm만으로 완료
                                            };
                                        }
                                    } else if (actionText.includes('대기완료')) {
                                        return {
                                            found: true,
                                            booked: false,
                                            alreadyBooked: true,
                                            message: '09:30 수업 대기예약이 이미 완료됨'
                                        };
                                    } else if (actionText.includes('예약완료') || actionText.includes('삭제') || actionText.includes('취소')) {
                                        return {
                                            found: true,
                                            booked: false,
                                            alreadyBooked: true,
                                            message: '09:30 수업은 이미 예약됨'
                                        };
                                    }
                                    
                                    break; // 09:30 찾았으므로 종료
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
            
            // 이미 예약된 경우 처리
            if (result.alreadyBooked) {
                await this.log('✅ 이미 예약/대기예약 완료된 상태 - 중복 예약 방지');
                this.bookingSuccess = true;
                if (result.message.includes('대기')) {
                    this.isWaitingReservation = true;
                }
                // 다이얼로그 핸들러 제거
                page.off('dialog', dialogHandler);
                return result;
            }
            
            // 예약 후 처리
            if (result.booked) {
                await this.log('⏳ 예약 처리 대기 중...');
                
                // 대기예약인 경우 confirm 처리 대기
                if (result.isWaitingOnly) {
                    await page.waitForTimeout(3000); // confirm 처리 대기
                } else if (result.needSubmit && !this.testMode) {
                    // 일반 예약의 경우 Submit 처리
                    await this.log('📝 Submit 처리 준비...');
                    await page.waitForTimeout(1000);
                    
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
                        
                        // 동시신청 오류 체크를 위한 대기
                        await page.waitForTimeout(1000);
                        
                        // 에러 플래그 체크
                        if (this.hasConflictError) {
                            await this.log('⚠️ 동시신청 충돌 감지 - 재시도 필요');
                            page.off('dialog', dialogHandler);
                            throw new Error('동시신청 충돌');
                        }
                        
                        if (this.hasTimeoutError) {
                            await this.log('⚠️ 시간초과 감지 - 재시도 필요');
                            page.off('dialog', dialogHandler);
                            throw new Error('시간초과');
                        }
                        
                        await this.takeScreenshot(page, '06-after-submit');
                    } else {
                        await this.log('⚠️ Submit 버튼을 찾지 못함');
                    }
                }
                
                await this.takeScreenshot(page, '07-booking-result');
            }
            
            // 다이얼로그 핸들러 제거
            page.off('dialog', dialogHandler);
            
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
                    '예약신청이 완료',
                    '요일별 예약횟수가 완료' // 새로 추가
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
            
            // 예약 내역 확인 (수정됨: 09:30 시간 확인으로 변경)
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
                
                // 09:30 수업 확인 (다양한 형식 지원)
                if (bodyText.includes('09:30') || bodyText.includes('09시30분') || 
                    bodyText.includes('9:30') || bodyText.includes('9시30분')) {
                    for (let format of dateFormats) {
                        if (bodyText.includes(format)) {
                            console.log(`✅ 예약 확인: ${format} 09:30`);
                            return { verified: true, format: format };
                        }
                    }
                    
                    if (bodyText.includes('09:30') || bodyText.includes('9:30')) {
                        console.log('✅ 09:30 수업 예약 확인');
                        return { verified: true, format: '09:30 found' };
                    }
                }
                
                // 대기예약 확인 (09:30)
                if (bodyText.includes('*') && (bodyText.includes('09:30') || bodyText.includes('9:30'))) {
                    console.log('✅ 09:30 대기예약 확인 (*)');
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
            
            // 3. 캘린더 페이지에서도 확인 - 개선된 버전
            await this.log('📅 캘린더에서 확인 시도...');
            await page.goto(`${this.baseUrl}/yeapp/yeapp.php?tm=102`, {
                waitUntil: 'networkidle2'
            });
            
            await page.waitForTimeout(2000);
            await this.takeScreenshot(page, '08-calendar-check');
            
            const calendarVerified = await page.evaluate((targetDay) => {
                const bodyText = document.body.innerText || document.body.textContent || '';
                console.log('캘린더 텍스트 샘플:', bodyText.substring(0, 500));
                
                // 더 정확한 패턴 매칭 - 개선된 버전
                const patterns = [
                    `${targetDay}\n*`,        // 줄바꿈 후 *
                    `${targetDay} *`,         // 공백 후 *
                    `${targetDay}*`,          // 바로 *
                    `${targetDay}\t*`,        // 탭 후 *
                    `${targetDay}\r\n*`,      // Windows 줄바꿈 후 *
                ];
                
                for (let pattern of patterns) {
                    if (bodyText.includes(pattern)) {
                        console.log(`✅ 캘린더에서 ${targetDay}일 예약 확인 (패턴: ${pattern})`);
                        return true;
                    }
                }
                
                // 정규식을 사용한 더 유연한 매칭
                const regex = new RegExp(`${targetDay}[\\s\\n\\t\\r]*\\*`);
                if (regex.test(bodyText)) {
                    console.log(`✅ 캘린더에서 ${targetDay}일 예약 확인 (정규식)`);
                    return true;
                }
                
                return false;
            }, targetInfo.day);
            
            if (calendarVerified) {
                await this.log('✅ 캘린더에서 예약이 확인되었습니다!');
                await this.takeScreenshot(page, '08-calendar-verified');
                return true;
            }
            
            // 대기예약이나 예약 성공 플래그가 있으면 성공으로 간주
            if (this.bookingSuccess) {
                await this.log('✅ 예약 프로세스 완료 - 대기예약 또는 예약 성공');
                return true;
            }
            
            await this.log('⚠️ 명시적 예약 확인 실패');
            return false;
            
        } catch (error) {
            await this.log(`⚠️ 예약 확인 과정 에러: ${error.message}`);
            return this.bookingSuccess; // 예약 성공 플래그로 판단
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
                
                // 1. 로그인
                await this.login(page);
                
                // 2. 예약 페이지로 이동
                const dateInfo = await this.navigateToBookingPage(page);
                
                // 3. 09:30 수업 찾고 예약
                const result = await this.find0930ClassAndBook(page);
                
                // 4. 결과 처리
                if (result.booked || result.alreadyBooked) {
                    await this.log('✅ 예약 프로세스 완료');
                    
                    let verified = false;
                    if (!this.testMode) {
                        verified = await this.verifyBooking(page);
                    }
                    
                    success = true;
                    
                    // 결과 저장 (09:30으로 변경)
                    const resultInfo = {
                        timestamp: this.getKSTDate().toISOString(),
                        date: `${dateInfo.year}-${dateInfo.month}-${dateInfo.day}`,
                        class: '09:30',
                        status: this.testMode ? 'TEST' : 
                               result.alreadyBooked ? (this.isWaitingReservation ? 'ALREADY_WAITING' : 'ALREADY_BOOKED') :
                               (this.isWaitingReservation ? 'WAITING' : 'SUCCESS'),
                        message: result.message,
                        verified: !this.testMode ? verified : null,
                        note: result.alreadyBooked ? '이미 예약/대기예약 완료 - 중복 방지' : 
                              verified ? '예약 확인 완료' : '예약 프로세스 완료',
                        kstTime: this.getKSTDate().toLocaleString('ko-KR'),
                        bookingSuccess: this.bookingSuccess,
                        isWaitingReservation: this.isWaitingReservation
                    };
                    
                    const resultFile = this.testMode ? 'test-result.json' : 'booking-result.json';
                    await fs.writeFile(
                        resultFile,
                        JSON.stringify(resultInfo, null, 2)
                    );
                    
                    await this.log('🎉🎉🎉 예약 프로세스 성공! 🎉🎉🎉');
                    
                    if (this.isWaitingReservation) {
                        await this.log('⚠️ 대기예약으로 등록되었습니다.');
                    }
                    
                    if (result.alreadyBooked) {
                        await this.log('📋 중복 예약 방지 - 이미 완료된 예약 확인');
                    }
                    
                } else if (result.found) {
                    throw new Error('예약 처리 실패');
                } else {
                    throw new Error('09:30 수업을 찾을 수 없음');
                }
                
            } catch (error) {
                retryCount++;
                await this.log(`❌ 시도 ${retryCount}/${this.maxRetries} 실패: ${error.message}`);
                
                if (retryCount < this.maxRetries) {
                    // 동시신청 오류시 랜덤 대기 시간 추가
                    let delay = this.retryDelay;
                    if (error.message.includes('동시신청')) {
                        delay = 3000 + Math.floor(Math.random() * 2000); // 3-5초 랜덤 대기
                        await this.log(`🎲 동시신청 충돌 - 랜덤 대기: ${delay}ms`);
                    } else if (error.message.includes('시간초과')) {
                        delay = 2000;
                    } else if (error.message.includes('타임 선택')) {
                        delay = 1000;
                    }
                    
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
                class: '09:30',
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
