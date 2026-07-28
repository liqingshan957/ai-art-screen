"""
Rembg 抠图 HTTP 服务
- POST /api/remove: 上传图片, 返回 PNG 抠图结果
- GET /api/health: 健康检查
"""
import os, io, sys, uuid, tempfile, time
from pathlib import Path

from rembg import remove, new_session

# 模型缓存目录
os.environ.setdefault("U2NET_HOME", str(Path(__file__).parent / "model_cache"))

# u2net_human 更适合人物抠图, 也可用 u2net (通用)
MODEL_NAME = os.environ.get("REMBG_MODEL", "u2net")

session = None
def get_session():
    global session
    if session is None:
        print(f"[Rembg] 加载模型: {MODEL_NAME} (首次加载较慢)")
        t0 = time.time()
        session = new_session(MODEL_NAME)
        print(f"[Rembg] 模型加载完成 ({time.time()-t0:.1f}s)")
    return session

# 用 Python 内置 http.server 实现, 零外部依赖
from http.server import HTTPServer, BaseHTTPRequestHandler
import json

class RembgHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/api/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            status = "ready" if session is not None else "loading"
            self.wfile.write(json.dumps({"status": status}).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path != "/api/remove":
            self.send_response(404)
            self.end_headers()
            return

        content_len = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_len)

        # 从 multipart 中提取文件
        content_type = self.headers.get("Content-Type", "")
        boundary = ""
        if "boundary=" in content_type:
            boundary = content_type.split("boundary=")[1].split(";")[0].strip()
            # 边界可能带引号
            if boundary.startswith('"') and boundary.endswith('"'):
                boundary = boundary[1:-1]

        if not boundary:
            self._json_error(400, "需要 multipart/form-data 上传")
            return

        file_data = self._extract_file(body, boundary)
        if not file_data:
            self._json_error(400, "未找到文件 (字段名: file)")
            return

        try:
            sess = get_session()
            result = remove(file_data, session=sess, only_mask=False)
            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            self.send_header("Content-Length", str(len(result)))
            self.end_headers()
            self.wfile.write(result)
        except Exception as e:
            self._json_error(500, str(e))

    def _extract_file(self, body, boundary):
        """从 multipart body 中提取文件二进制"""
        boundary_bytes = boundary.encode("utf-8")
        parts = body.split(b"--" + boundary_bytes)
        for part in parts:
            if b'name="file"' in part and b"\r\n\r\n" in part:
                # 跳过头部
                header_end = part.index(b"\r\n\r\n") + 4
                file_data = part[header_end:]
                # 去掉尾部的 \r\n--
                if file_data.endswith(b"\r\n"):
                    file_data = file_data[:-2]
                if file_data.endswith(b"--"):
                    file_data = file_data[:-2]
                return file_data
        return None

    def _json_error(self, code, msg):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"error": msg}).encode())

    def log_message(self, format, *args):
        print(f"[Rembg] {args[0]} {args[1]} {args[2]}")


def main():
    port = int(os.environ.get("REMBG_PORT", "7000"))
    server = HTTPServer(("0.0.0.0", port), RembgHandler)
    print(f"[Rembg] 服务启动 http://0.0.0.0:{port}")
    print(f"[Rembg] 模型: {MODEL_NAME}")
    print(f"[Rembg] 缓存: {os.environ['U2NET_HOME']}")
    print(f"[Rembg] API:")
    print(f"  POST /api/remove  (multipart: file=image)")
    print(f"  GET  /api/health")
    # 后台预加载模型(首次请求时加载)
    print("[Rembg] 正在加载模型...")
    t0 = time.time()
    get_session()
    print(f"[Rembg] 模型加载完成 ({time.time()-t0:.1f}s)")
    server.serve_forever()

if __name__ == "__main__":
    main()
