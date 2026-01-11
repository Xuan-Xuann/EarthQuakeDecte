/**
 * 地震检测算法库
 * 包含震度、烈度等地震信息检测算法
 */

/**
 * 计算地震震级
 * @param {number} ax - X轴加速度值
 * @param {number} ay - Y轴加速度值
 * @param {number} az - Z轴加速度值
 * @returns {number} 计算出的震级值 (0-10)
 */
function calculateMagnitude(ax, ay, az) {
  // 计算加速度矢量和
  const acceleration = Math.sqrt(
    Math.pow(ax, 2) + 
    Math.pow(ay, 2) + 
    Math.pow(az, 2)
  );
  
  // 转换为震级（简化公式）
  // 这里使用对数标度，实际算法可能需要校准
  const magnitude = Math.log10(acceleration + 1) * 2;
  return Math.max(0, Math.min(magnitude, 10)); // 限制在0-10范围内
}

/**
 * 计算地震烈度（基于修订麦加利地震烈度表）
 * @param {number} ax - X轴加速度值
 * @param {number} ay - Y轴加速度值
 * @param {number} az - Z轴加速度值
 * @param {number} distance - 距离震中的距离（千米），默认为10km
 * @returns {number} 修订麦加利地震烈度 (I-XII)
 */
function calculateIntensity(ax, ay, az, distance = 10) {
  // 计算加速度矢量和
  const acceleration = Math.sqrt(
    Math.pow(ax, 2) + 
    Math.pow(ay, 2) + 
    Math.pow(az, 2)
  );
  
  // 根据加速度估算震级
  const magnitude = Math.log10(acceleration + 1) * 2;
  
  if (distance <= 0) distance = 1; // 避免除零
  
  // 简化的烈度计算公式，基于震级和距离
  // 实际计算会更复杂，需要考虑地质条件、建筑物类型等因素
  let intensity = magnitude - Math.log10(distance) * 0.2 - 0.5;
  
  // 将结果映射到麦加利烈度表 (I-XII)
  // 保证烈度在合理范围内
  return Math.max(1, Math.min(12, intensity));
}

/**
 * 计算地震震度（日本气象厅标准）
 * @param {number} ax - X轴加速度値
 * @param {number} ay - Y轴加速度値
 * @param {number} az - Z軸加速度値
 * @param {number} correctionFactor - 校正係数，默认为1.0
 * @returns {object} 包含震度和PGA（峰值地面加速度）的对象
 */
function calculateJmaSeismicIntensity(ax, ay, az, correctionFactor = 1.0) {
  // 計算峰值地面加速度 (PGA) m/s²
  const PGA = Math.sqrt(Math.pow(ax, 2) + Math.pow(ay, 2) + Math.pow(az, 2)) * 9.8; // 轉換為 m/s²
  
  // 適用校正係数
  const correctedPGA = PGA * correctionFactor;
  
  // 日本気象庁震度計算公式
  let intensity;
  if (correctedPGA < 0.0017) {
    intensity = 0; // 0.0以下
  } else if (correctedPGA < 0.014) {
    intensity = 1; // 1.0-1.5
  } else if (correctedPGA < 0.039) {
    intensity = 1.5; // 1.5-2.0
  } else if (correctedPGA < 0.098) {
    intensity = 2; // 2.0-2.5
  } else if (correctedPGA < 0.197) {
    intensity = 2.5; // 2.5-3.0
  } else if (correctedPGA < 0.394) {
    intensity = 3; // 3.0-3.5
  } else if (correctedPGA < 0.787) {
    intensity = 3.5; // 3.5-4.0
  } else if (correctedPGA < 1.637) {
    intensity = 4; // 4.0-4.5
  } else if (correctedPGA < 3.386) {
    intensity = 4.5; // 4.5-5.0
  } else if (correctedPGA < 6.889) {
    intensity = 5; // 5.0-5.5
  } else if (correctedPGA < 14.050) {
    intensity = 5.5; // 5.5-6.0
  } else if (correctedPGA < 28.650) {
    intensity = 6; // 6.0-6.5
  } else {
    intensity = 6.5; // 6.5以上
  }
  
  return {
    intensity: intensity,
    pga: correctedPGA,
    pga_raw: PGA
  };
}

/**
 * 判断地震类型
 * @param {number} magnitude - 震级
 * @returns {string} 地震类型描述
 */
function classifyEarthquake(magnitude) {
  if (magnitude < 2.0) return '微震';
  if (magnitude < 3.0) return '弱震';
  if (magnitude < 5.0) return '轻震';
  if (magnitude < 6.0) return '中震';
  if (magnitude < 7.0) return '强震';
  if (magnitude < 8.0) return '大地震';
  return '巨大地震';
}

/**
 * 评估地震警报级别
 * @param {number} magnitude - 震级
 * @param {number} intensity - 烈度
 * @returns {object} 警报级别和描述
 */
function assessAlertLevel(magnitude, intensity) {
  let level, message, color;
  
  if (magnitude >= 7.0 || intensity >= 9) {
    level = '严重';
    message = '强烈地震，可能造成重大损害';
    color = 'red';
  } else if (magnitude >= 5.0 || intensity >= 7) {
    level = '高';
    message = '较强地震，可能造成损害';
    color = 'orange';
  } else if (magnitude >= 4.0 || intensity >= 5) {
    level = '中';
    message = '中等地震，可能感受到震动';
    color = 'yellow';
  } else if (magnitude >= 3.0 || intensity >= 3) {
    level = '低';
    message = '轻微地震，可能被部分人感受到';
    color = 'blue';
  } else {
    level = '無';
    message = '未检测到地震活动';
    color = 'green';
  }
  
  return {
    level: level,
    message: message,
    color: color
  };
}

/**
 * 检测地震事件
 * @param {number} magnitude - 震级
 * @param {number} threshold - 阈值，默认为3.0
 * @returns {boolean} 是否为地震事件
 */
function detectEarthquake(magnitude, threshold = 3.0) {
  return magnitude >= threshold;
}

/**
 * 计算地震能量
 * @param {number} magnitude - 震级
 * @returns {number} 相对能量値
 */
function calculateEnergy(magnitude) {
  // 使用Gutenberg-Richter能量关系式
  // logE = 4.8 + 1.5M
  const energy = Math.pow(10, 4.8 + 1.5 * magnitude);
  return energy;
}

/**
 * 计算地震影响范围（简化模型）
 * @param {number} magnitude - 震级
 * @returns {object} 不同烈度的影响半径
 */
function calculateImpactRadius(magnitude) {
  // 简化的震级与影响范围关系
  const radius = {
    // 烈度8以上范围
    extreme: magnitude > 6.0 ? Math.pow(10, magnitude/2 - 1) : 0,
    // 烈度6-7范围
    strong: magnitude > 5.0 ? Math.pow(10, magnitude/2) : Math.pow(10, magnitude/2.5),
    // 烈度4-5范围
    moderate: Math.pow(10, magnitude/2 + 1),
    // 感知范围
    felt: Math.pow(10, magnitude/1.5 + 2)
  };
  
  return radius;
}

// 导出函数以供其他模块使用
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    calculateMagnitude,
    calculateIntensity,
    calculateJmaSeismicIntensity,
    classifyEarthquake,
    assessAlertLevel,
    detectEarthquake,
    calculateEnergy,
    calculateImpactRadius
  };
}