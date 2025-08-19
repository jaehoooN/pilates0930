// wait-until-midnight.js (새 파일명)
const waitUntilMidnight = async () => {  // ⚠️ 함수명도 변경
  console.log('⏰ 자정 대기 스크립트 시작');
  
  const getKSTTime = () => {
    const now = new Date();
    const kstOffset = 9 * 60;
    const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000);
    return new Date(utcTime + (kstOffset * 60000));
  };
  
  const kstNow = getKSTTime();
  console.log(`현재 한국 시간: ${kstNow.toLocaleString('ko-KR')}`);
  
  const target = new Date(kstNow);
  
  // 자정 설정
  if (kstNow.getHours() === 23 && kstNow.getMinutes() >= 50) {
    target.setDate(target.getDate() + 1);
    target.setHours(0, 0, 0, 0);
  } else if (kstNow.getHours() === 0 && kstNow.getMinutes() === 0) {
    console.log('✅ 이미 자정입니다.');
    return;
  } else {
    target.setDate(target.getDate() + 1);
    target.setHours(0, 0, 0, 0);
  }
  
  const waitMs = target - kstNow;
  const waitMinutes = Math.floor(waitMs / 60000);
  const waitSeconds = Math.floor((waitMs % 60000) / 1000);
  
  console.log(`⏳ 대기 시간: ${waitMinutes}분 ${waitSeconds}초`);
  console.log(`⏰ 예약 시작 예정: ${target.toLocaleString('ko-KR')}`);
  
  await new Promise(resolve => {
    const interval = setInterval(() => {
      const now = getKSTTime();
      const remaining = target - now;
      
      if (remaining <= 0) {
        clearInterval(interval);
        console.log('✅ 자정 00분 00초 도달!');
        resolve();
      } else if (remaining < 10000) {
        const seconds = Math.ceil(remaining / 1000);
        console.log(`🔥 ${seconds}...`);
      }
    }, 100);
  });
};

module.exports = { waitUntilMidnight };  // ⚠️ export 이름도 변경

if (require.main === module) {
  waitUntilMidnight().then(() => {  // ⚠️ 호출 함수명도 변경
    console.log('✅ 대기 완료');
  }).catch(error => {
    console.error('❌ 오류:', error);
  });
}
