import type {Text} from "@/lib/preferences";
import type {AttentionState, DriverSeverity, HeadDirection} from "@/lib/driver/types";

export const STATE_LABEL: Record<AttentionState, Text> = {
  attentive: {vi: "Tập trung", en: "Attentive"},
  distracted: {vi: "Mất tập trung", en: "Distracted"},
  drowsy: {vi: "Buồn ngủ", en: "Drowsy"},
  no_face: {vi: "Không thấy tài xế", en: "No driver in view"},
  uncertain: {vi: "Chưa chắc chắn", en: "Uncertain"},
};

export const STATE_HINT: Record<AttentionState, Text> = {
  attentive: {vi: "Mắt mở, đầu hướng về phía trước.", en: "Eyes open, head facing the road."},
  distracted: {vi: "Đầu quay khỏi hướng đường quá 2 giây.", en: "Head turned away from the road for over 2 seconds."},
  drowsy: {vi: "Mắt nhắm quá lâu hoặc quá thường xuyên.", en: "Eyes closed too long or too often."},
  no_face: {vi: "Camera không thấy khuôn mặt trong khung hình.", en: "The camera cannot see a face."},
  uncertain: {vi: "Ánh sáng hoặc góc camera chưa đủ để đánh giá.", en: "Light or camera angle is not good enough to judge."},
};

export const SEVERITY_LABEL: Record<DriverSeverity, Text> = {
  normal: {vi: "Bình thường", en: "Normal"},
  warning: {vi: "Cảnh báo", en: "Warning"},
  critical: {vi: "Nguy hiểm", en: "Critical"},
};

export const DIRECTION_LABEL: Record<HeadDirection, Text> = {
  forward: {vi: "Phía trước", en: "Ahead"},
  left: {vi: "Sang trái", en: "Left"},
  right: {vi: "Sang phải", en: "Right"},
  up: {vi: "Lên trên", en: "Up"},
  down: {vi: "Xuống dưới", en: "Down"},
};
