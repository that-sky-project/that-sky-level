# `.meshes`关卡信息解析
.meshes文件分为TOC段、GEO段、LOD段与METR段。

## TOC段
TOC段也即文件头，包含了level的元信息：

```cpp
struct meshes::TOC {
  struct Item {
    // 段类型
    char type[4];
    // 段起始偏移量，相对于文件起始
    u32 offset;
    // 段长度
    u32 size;
  };

  // 文件魔数，始终为'LVL0'也即0x304C564C
  u32 magic;
  // 段数量
  u32 count;
  // 段描述符数组
  Item items[count];
  // Level的包围盒小端
  v3f minBound;
  // Level的包围盒大端
  v3f maxBound;
};
```

虽然源码中并未规范items的最大长度，但是游戏读取文件头时只会读取前140字节，因此生成时需确保TOC段总大小不超过140字节。

段类型可以为"LOD0"、"GEO0"或"METR"。

GEO段一个level只允许有一个，并且在加载新level时**不会清除**上一个level的GEO段。若你的level不包含GEO段，请设置一个`Item { "GEO0", 0, 0 }`、强制使游戏忽略GEO段，而不能不写入该段描述符，否则游戏将错误地使用上一个加载的level的GEO段描述符读取GEO段，引发崩溃。

## GEO段
GEO段包含了level的地形信息。

### 结构总览
```cpp
struct meshes::GEO {
  // 顶点，36字节。一个顶点可以出现在多个子区块中，前提是该顶点包含子区块所含的材质
  struct Vertex {
    // 顶点坐标
    v3f pos;
    // 顶点法线，R8G8B8A8_SNORM
    u08 normal[4];
    // 顶点所包含的材质，最多可为4种。[0]为主材质，物理效果以主材质为准
    u08 materials[4];
    // 材质权重，决定显示的占比
    u08 materialWeights[4];
    // 当前未知
    u32 unk[3];
  };

  struct Subchunk {
    // 子区块的材质
    u08 materialId;
    // 包含的三角形数量，也即包含的顶点数量除以3
    u08 triangleCount;
    // 包含的顶点数量
    u08 vtxCount;
    // 包含的三角形范围在子区块所属区块决定的索引缓冲范围内的起始索引
    u08 triangleStart;
    // 同上，结束索引
    u08 triangleEnd;
    // 包含的顶点范围在子区块所属区块决定的顶点缓冲范围内的起始索引
    u08 vtxStart;
    // 同上，结束索引
    u08 vtxEnd;
    // 当前未知，可能仅作填充
    u08 unk;
  };

  struct Chunk {
    // 包含的顶点范围在总索引缓冲内的起始索引
    u32 vtxStart;
    // 包含的索引范围在总索引缓冲内的起始索引
    u32 idxStart;
    // 包含的子区块范围在总索引缓冲内的起始索引
    u32 areaStart;

    // 包含的索引数量
    u16 idxCount;
    // 包含的顶点数量
    u08 vtxCount;
    // 包含的Area数量
    u08 areaCount;

    // 区块所有顶点组成的AABB包围盒。用于计算碰撞箱
    // 超出该包围盒的顶点不会被计算碰撞
    v3f min;
    v3f max;

    // 当前未知
    u32 unk[4];
  };

  // 总索引数量
  u32 indexCount;
  // 总顶点数量
  u32 vertexCount;
  // 总区块数量
  u32 chunkCount;
  // 当前未知，和chunkCount相加以计算区块总数
  // 一般设为0
  u32 unk;
  // 总子区块数量
  u32 subchunkCount;
  // 条件字段，在vertexCount > 0才会读取
  if (vertexCount > 0) {
    // 使用Meshopt压缩后的顶点总大小
    u32 compressedSize;
    // 压缩后的顶点数据，使用Meshopt ver 1压缩
    // 解压后得到Vertex vertices[vertexCount]
    u08 compressedVertex;
  }
  // 局部索引缓冲，也即子区块包含的顶点区域内的索引
  u08 indices[indexCount];
  // 区块列表
  Chunk chunks[chunkCount];
  // 子区块列表
  Subchunk subchunks[subchunkCount];
};
```

### 网格重组过程
区块描述符将`vertices`、`indices`与`subchunks`依区块分割为一个个连续且一般无重叠的区域，上文提到的“所属”便是该对象落入某一个区块指定的缓冲区范围的过程。一个区块最多包含255顶点、255三角形、255子区块。区块的作用是确定地形的碰撞箱，只有在区块包围盒指定的范围内的碰撞会被计算。

子区块的作用是确定顶点的材质。子区块内的索引与范围均指其所属的区块内的索引。
