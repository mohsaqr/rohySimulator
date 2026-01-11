const defaultRegions = {
  "anterior": {
    "male": {
      "headNeck": {"id": "headNeck","label": "Head & Neck","color": "#ff6b6b","points": [[43,4],[53,4],[57,9],[55,19],[42,19],[39,8]]},
      "chest": {"id": "chest","label": "Chest","color": "#ffa94d","points": [[38,18],[59,18],[64,20],[62,34],[33,34],[30,20]]},
      "upperArmLeft": {"id": "upperArmLeft","label": "L. Upper Arm","color": "#ffd43b","points": [[28,22],[33,20],[31,25],[33,36],[24,37],[25,33]]},
      "upperArmRight": {"id": "upperArmRight","label": "R. Upper Arm","color": "#ffd43b","points": [[64,21],[71,21],[71,32],[72,36],[64,37],[65,27]]},
      "forearmLeft": {"id": "forearmLeft","label": "L. Forearm","color": "#69db7c","points": [[24,37],[33,37],[32,41],[27,49],[20,48]]},
      "forearmRight": {"id": "forearmRight","label": "R. Forearm","color": "#69db7c","points": [[63,37],[73,37],[78,49],[71,50],[68,44]]},
      "handLeft": {"id": "handLeft","label": "L. Hand","color": "#4dabf7","points": [[18,49],[27,50],[23,59],[11,56]]},
      "handRight": {"id": "handRight","label": "R. Hand","color": "#4dabf7","points": [[70,50],[79,49],[87,57],[74,59]]},
      "abdomen": {"id": "abdomen","label": "Abdomen","color": "#9775fa","points": [[33,34],[63,34],[62,46],[35,46]]},
      "pelvis": {"id": "pelvis","label": "Pelvis","color": "#f06595","points": [[34,46],[62,46],[64,54],[33,54]]},
      "thighLeft": {"id": "thighLeft","label": "L. Thigh","color": "#20c997","points": [[33,54],[50,54],[45,74],[36,74]]},
      "thighRight": {"id": "thighRight","label": "R. Thigh","color": "#20c997","points": [[48,54],[64,54],[62,74],[51,74]]},
      "lowerLegLeft": {"id": "lowerLegLeft","label": "L. Lower Leg","color": "#38d9a9","points": [[35,74],[47,74],[46,91],[38,91]]},
      "lowerLegRight": {"id": "lowerLegRight","label": "R. Lower Leg","color": "#38d9a9","points": [[51,74],[62,74],[58,91],[50,91]]},
      "footLeft": {"id": "footLeft","label": "L. Foot","color": "#3bc9db","points": [[40,91],[46,91],[44,98],[34,98]]},
      "footRight": {"id": "footRight","label": "R. Foot","color": "#3bc9db","points": [[52,91],[59,91],[63,98],[51,98]]}
    },
    "female": {
      "headNeck": {"id": "headNeck","label": "Head & Neck","color": "#ff6b6b","points": [[40,2],[52,2],[56,7],[51,16],[41,16],[35,8]]},
      "chest": {"id": "chest","label": "Chest","color": "#ffa94d","points": [[40,16],[51,16],[63,19],[61,32],[32,32],[30,19]]},
      "upperArmLeft": {"id": "upperArmLeft","label": "L. Upper Arm","color": "#ffd43b","points": [[25,19],[31,19],[31,32],[30,36],[22,35],[22,29]]},
      "upperArmRight": {"id": "upperArmRight","label": "R. Upper Arm","color": "#ffd43b","points": [[63,18],[70,22],[70,35],[61,36],[61,32],[63,25]]},
      "forearmLeft": {"id": "forearmLeft","label": "L. Forearm","color": "#69db7c","points": [[21,34],[30,36],[29,42],[22,50],[16,50]]},
      "forearmRight": {"id": "forearmRight","label": "R. Forearm","color": "#69db7c","points": [[61,36],[70,35],[73,40],[76,48],[69,50]]},
      "handLeft": {"id": "handLeft","label": "L. Hand","color": "#4dabf7","points": [[14,50],[24,50],[18,61],[7,55]]},
      "handRight": {"id": "handRight","label": "R. Hand","color": "#4dabf7","points": [[69,49],[81,50],[83,59],[72,59]]},
      "abdomen": {"id": "abdomen","label": "Abdomen","color": "#9775fa","points": [[32,32],[58,32],[63,45],[29,45]]},
      "pelvis": {"id": "pelvis","label": "Pelvis","color": "#f06595","points": [[29,45],[64,45],[67,55],[26,55]]},
      "thighLeft": {"id": "thighLeft","label": "L. Thigh","color": "#20c997","points": [[26,55],[46,55],[45,73],[33,73]]},
      "thighRight": {"id": "thighRight","label": "R. Thigh","color": "#20c997","points": [[46,55],[67,55],[58,73],[47,73]]},
      "lowerLegLeft": {"id": "lowerLegLeft","label": "L. Lower Leg","color": "#38d9a9","points": [[33,73],[46,73],[43,90],[35,91]]},
      "lowerLegRight": {"id": "lowerLegRight","label": "R. Lower Leg","color": "#38d9a9","points": [[46,73],[60,73],[57,90],[49,90]]},
      "footLeft": {"id": "footLeft","label": "L. Foot","color": "#3bc9db","points": [[36,91],[43,91],[43,100],[30,99]]},
      "footRight": {"id": "footRight","label": "R. Foot","color": "#3bc9db","points": [[49,91],[57,91],[61,100],[47,100]]}
    }
  },
  "posterior": {
    "male": {
      "headNeck": {"id": "headNeck","label": "Head & Neck","color": "#ff6b6b","points": [[48,5],[54,5],[59,9],[57,17],[46,17],[43,10]]},
      "upperBack": {"id": "upperBack","label": "Upper Back","color": "#ffa94d","points": [[46,17],[57,17],[72,22],[67,31],[36,31],[30,22]]},
      "upperArmLeft": {"id": "upperArmLeft","label": "L. Upper Arm","color": "#ffd43b","points": [[27,38],[28,33],[28,30],[30,22],[36,31],[37,38]]},
      "upperArmRight": {"id": "upperArmRight","label": "R. Upper Arm","color": "#ffd43b","points": [[72,23],[75,30],[77,39],[67,40],[66,41],[67,32]]},
      "forearmLeft": {"id": "forearmLeft","label": "L. Forearm","color": "#69db7c","points": [[25,38],[36,39],[35,44],[31,51],[25,50]]},
      "forearmRight": {"id": "forearmRight","label": "R. Forearm","color": "#69db7c","points": [[66,41],[78,39],[78,49],[73,50],[69,47]]},
      "handLeft": {"id": "handLeft","label": "L. Hand","color": "#4dabf7","points": [[24,50],[30,51],[24,60],[14,55]]},
      "handRight": {"id": "handRight","label": "R. Hand","color": "#4dabf7","points": [[72,50],[79,49],[89,56],[78,60]]},
      "lowerBack": {"id": "lowerBack","label": "Lower Back","color": "#9775fa","points": [[37,31],[66,31],[65,44],[39,44]]},
      "buttocks": {"id": "buttocks","label": "Buttocks","color": "#f06595","points": [[38,44],[66,44],[68,54],[36,54]]},
      "thighLeft": {"id": "thighLeft","label": "L. Thigh","color": "#20c997","points": [[36,54],[51,54],[49,74],[40,74]]},
      "thighRight": {"id": "thighRight","label": "R. Thigh","color": "#20c997","points": [[52,54],[67,54],[63,74],[54,74]]},
      "calfLeft": {"id": "calfLeft","label": "L. Calf","color": "#38d9a9","points": [[39,74],[49,74],[48,90],[41,90]]},
      "calfRight": {"id": "calfRight","label": "R. Calf","color": "#38d9a9","points": [[53,74],[64,74],[62,90],[54,90]]},
      "heelLeft": {"id": "heelLeft","label": "L. Heel","color": "#3bc9db","points": [[42,90],[48,90],[50,99],[38,97]]},
      "heelRight": {"id": "heelRight","label": "R. Heel","color": "#3bc9db","points": [[55,90],[61,90],[65,98],[54,99]]}
    },
    "female": {
      "headNeck": {"id": "headNeck","label": "Head & Neck","color": "#ff6b6b","points": [[45,3],[54,3],[59,7],[55,16],[44,16],[41,7]]},
      "upperBack": {"id": "upperBack","label": "Upper Back","color": "#ffa94d","points": [[43,16],[56,16],[70,20],[64,32],[36,32],[30,20]]},
      "upperArmLeft": {"id": "upperArmLeft","label": "L. Upper Arm","color": "#ffd43b","points": [[29,21],[34,25],[36,33],[34,37],[27,36],[26,26]]},
      "upperArmRight": {"id": "upperArmRight","label": "R. Upper Arm","color": "#ffd43b","points": [[70,20],[73,25],[73,32],[74,35],[65,36],[64,32]]},
      "forearmLeft": {"id": "forearmLeft","label": "L. Forearm","color": "#69db7c","points": [[22,45],[26,36],[34,37],[29,50],[21,50]]},
      "forearmRight": {"id": "forearmRight","label": "R. Forearm","color": "#69db7c","points": [[65,37],[74,35],[79,49],[72,49],[67,42]]},
      "handLeft": {"id": "handLeft","label": "L. Hand","color": "#4dabf7","points": [[14,50],[28,50],[26,58],[16,58]]},
      "handRight": {"id": "handRight","label": "R. Hand","color": "#4dabf7","points": [[72,50],[84,49],[86,58],[78,58]]},
      "lowerBack": {"id": "lowerBack","label": "Lower Back","color": "#9775fa","points": [[36,32],[64,32],[66,44],[35,44]]},
      "buttocks": {"id": "buttocks","label": "Buttocks","color": "#f06595","points": [[34,44],[66,44],[68,56],[32,56]]},
      "thighLeft": {"id": "thighLeft","label": "L. Thigh","color": "#20c997","points": [[33,56],[50,56],[48,74],[38,74]]},
      "thighRight": {"id": "thighRight","label": "R. Thigh","color": "#20c997","points": [[50,56],[68,56],[62,74],[52,74]]},
      "calfLeft": {"id": "calfLeft","label": "L. Calf","color": "#38d9a9","points": [[38,74],[48,74],[46,90],[38,90]]},
      "calfRight": {"id": "calfRight","label": "R. Calf","color": "#38d9a9","points": [[52,74],[62,74],[61,90],[54,90]]},
      "heelLeft": {"id": "heelLeft","label": "L. Heel","color": "#3bc9db","points": [[38,90],[48,90],[48,100],[37,97]]},
      "heelRight": {"id": "heelRight","label": "R. Heel","color": "#3bc9db","points": [[52,90],[62,90],[63,97],[52,100]]}
    }
  }
}
export default defaultRegions;